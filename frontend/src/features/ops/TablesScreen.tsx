/**
 * Floor view (docs/20_High_Volume_UX.md): compact tiles for 60+ tables with status colour, running time
 * (amber / red after the business's Floor alert times, 45 / 75 min by default), bill amount, guests, ready-to-serve count, UPI-to-confirm and the waiter.
 * Tap = open in Billing; long-press / right-click (via the menu's `menuRef`) or ⋯ = anchored ActionMenu (move, merge, print, QR, waiter…).
 * Refreshes every 8 s while visible.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import {
  ActionMenu, Button, Chip, EmptyState, ErrorState, FilterBar, IconButton, Screen, Sheet, Skeleton, Text, confirm, statusToneColors, toast,
  type ActionMenuHandle, type ActionMenuItem, type StatusTone,
} from '@/components/ui';
import { QrCode } from '@/components/QrCode';
import { ordersApi, tablesApi } from '@/api/endpoints';
import { ApiError, errorMessage } from '@/api/client';
import type { TableBill, TableInfo } from '@/api/types';
import { floorApi, opsApi } from '@/api/floor';
import { useAuth, can } from '@/store/auth';
import { useData } from '@/store/data';
import { useBadges } from '@/store/badges';
import { printBill, printErrorMessage } from '@/lib/billing';
import { money } from '@/lib/format';
import { ActionMenu as ListSheet, ChipRow, Grid, Notice, tableOrderUrl, type MenuAction } from './common';
import { TableForm } from './TableForm';
import { printTableQrs } from './tableQr';
import { billName, kitchenProgress } from '../pos/runningBill';
import {
  NO_SECTION, ageTone, billsOf, formatAge, initials, matchesTableFilter, sectionCounts, summarizeTable, tableFilterCounts,
  type AgeThresholds, type TableFilter, type TableState, type TableSummary,
} from './floorLogic';
import { useFloorAges } from './useFloorAges';
import { useDevicePref, useLivePoll, useNow } from '@/hooks/live';
import { AgeChip, GroupTitle, LiveStatus, WaiterAvatar, useContextMenu } from './parts';
import { t as tr } from '@/i18n';

const POLL_MS = 8_000;
const STATE_TONE: Record<TableState, StatusTone> = { free: 'neutral', new: 'pending', occupied: 'progress', ready: 'ready', payment: 'waiting' };
const STATE_LABEL: Record<TableState, string> = { get free() { return tr('common.free'); }, get new() { return tr('ops.TablesScreen.new_qr_order'); }, get occupied() { return tr('common.running'); }, get ready() { return tr('ops.TablesScreen.food_ready'); }, get payment() { return tr('ops.TablesScreen.waiting_payment'); } };

type Size = 'compact' | 'large';

export default function TablesScreen() {
  const { colors } = useTheme();
  const { isPhone, isDesktop } = useLayout();
  const role = useAuth((s) => s.session?.role ?? null);
  const tenantId = useAuth((s) => s.session?.tenantId ?? '');
  const me = useAuth((s) => s.session);
  const settings = useData((s) => s.settings);
  const businessName = settings?.business_name ?? me?.businessName ?? 'Our restaurant';
  const sym = settings?.currency_symbol ?? '₹';
  const now = useNow(15_000);
  const manager = can(role, 'manage');
  const canOrder = can(role, 'order');

  const poll = useLivePoll(() => tablesApi.list(), [], POLL_MS);
  const { data, error, loading, reload, silentReload } = poll;

  const ages = useFloorAges();
  // Waiter names come with GET /tables (bill waiter_name, table assigned_staff_name), so every role sees them.
  const nameOf = useCallback((s: TableSummary) => {
    if (!s.waiterId) return null;
    if (me?.userId === s.waiterId && me.fullName) return me.fullName;
    return s.waiterName;
  }, [me?.userId, me?.fullName]);

  const [filter, setFilter] = useState<TableFilter>('all');
  const [section, setSection] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [size, setSize] = useDevicePref<Size>('tables.size', 'compact');
  const [moveFrom, setMoveFrom] = useState<{ table: TableInfo; mode: 'move' | 'merge' } | null>(null);
  const [waiterFor, setWaiterFor] = useState<TableInfo | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<TableInfo | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  // The "Assign waiter" picker (managers) loads the staff list the first time it opens
  const [staff, setStaff] = useState<StaffOption[] | 'denied' | null>(null);
  useEffect(() => {
    if (!waiterFor || staff) return;
    opsApi.staff().then((list) => setStaff(list.filter((x) => x.is_active)), () => setStaff('denied'));
  }, [waiterFor, staff]);
  const staffList = Array.isArray(staff) ? staff : null;

  const tables = data ?? [];
  const summaries = useMemo(() => tables.map((t) => summarizeTable(t, now)), [tables, now]);
  const byId = useMemo(() => new Map(tables.map((t, i) => [t.id, summaries[i]!])), [tables, summaries]);
  const sections = useMemo(() => sectionCounts(tables, (i) => summaries[i]!.bills.length > 0), [tables, summaries]);
  const realSections = sections.filter((s) => s.name !== NO_SECTION || sections.length > 1);
  const inSection = useMemo(
    () => tables.map((t, i) => ({ t, s: summaries[i]! })).filter(({ t }) => !section || (t.section?.trim() || NO_SECTION) === section),
    [tables, summaries, section],
  );
  const counts = useMemo(() => tableFilterCounts(inSection.map((x) => x.s)), [inSection]);
  const q = query.trim().toLowerCase();
  const visible = useMemo(() => inSection.filter(({ t, s }) => matchesTableFilter(s, filter)
    && (!q || t.table_number.toLowerCase().includes(q) || s.bills.some((b) => (b.customer_name ?? '').toLowerCase().includes(q) || b.code.toLowerCase().includes(q)))),
  [inSection, filter, q]);
  const groups = useMemo(() => {
    const map = new Map<string, { t: TableInfo; s: TableSummary }[]>();
    for (const row of visible) {
      const key = row.t.section?.trim() || NO_SECTION;
      map.set(key, [...(map.get(key) ?? []), row]);
    }
    return Array.from(map.entries());
  }, [visible]);

  const occupied = summaries.filter((s) => s.bills.length > 0);
  const runningTotal = occupied.reduce((a, s) => a + s.total, 0);
  const readyLines = summaries.reduce((a, s) => a + s.ready, 0);

  const refreshAll = useCallback(() => { void silentReload(); void useBadges.getState().refresh(); }, [silentReload]);

  const openBill = useCallback((b: TableBill) => {
    if (b.status === 'placed') router.push('/online');
    else router.push({ pathname: '/pos', params: { order: b.id } });
  }, []);

  /** One tap: a single bill opens straight away; several bills let Billing ask which one; a free table starts a bill. */
  const open = useCallback((t: TableInfo) => {
    if (!canOrder) { toast.info(tr('ops.TablesScreen.your_role_can_view_tables_but_not_take')); return; }
    const bills = billsOf(t);
    if (bills.length === 1) openBill(bills[0]!);
    else router.push({ pathname: '/pos', params: { table: t.id } });
  }, [canOrder, openBill]);

  const printTableBill = useCallback(async (t: TableInfo, bill: TableBill) => {
    toast.info(tr('ops.TablesScreen.preparing_bill'));
    try {
      const order = await ordersApi.get(bill.id);
      await printBill({ ...order, table_label: order.table_label ?? t.table_number }, settings);
    } catch (e) {
      toast.error(e instanceof ApiError ? errorMessage(e) : printErrorMessage(e));
    }
  }, [settings]);

  const removeTable = useCallback(async (t: TableInfo) => {
    const ok = await confirm({
      title: tr('ops.TablesScreen.remove_table_table_number', { table_number: t.table_number }),
      message: tr('ops.TablesScreen.it_disappears_from_the_floor_view_and_its'),
      confirmLabel: tr('ops.TablesScreen.remove_table'), danger: true,
    });
    if (!ok) return;
    try {
      await tablesApi.remove(t.id);
      toast.success(tr('ops.TablesScreen.table_table_number_removed', { table_number: t.table_number }));
      void silentReload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }, [silentReload]);

  const printOneQr = useCallback(async (t: TableInfo) => {
    try {
      await printTableQrs([t], tenantId, businessName);
    } catch (e) {
      toast.error(printErrorMessage(e));
    }
  }, [tenantId, businessName]);

  const menuFor = useCallback((t: TableInfo): ActionMenuItem[] => {
    const s = byId.get(t.id);
    const bills = s?.bills ?? [];
    const busy = bills.length > 0;
    const items: ActionMenuItem[] = [];
    if (canOrder) {
      bills.forEach((b, i) => {
        const progress = kitchenProgress(b.kitchen);
        items.push({
          key: `open-${b.id}`, group: 'bills', icon: b.status === 'placed' ? 'notifications-outline' : 'receipt-outline',
          label: b.status === 'placed' ? tr('ops.TablesScreen.review_new_qr_order_v', { v: bills.length > 1 ? ` (${billName(b, i)})` : '' }) : bills.length > 1 ? tr('ops.TablesScreen.open_billname', { billName: billName(b, i) }) : tr('ops.TablesScreen.open_bill'),
          description: [money(b.total_amount, sym), progress?.label, b.guests ? `${b.guests} guests` : null].filter(Boolean).join(' · '),
          onPress: () => openBill(b),
        });
      });
      items.push(busy
        ? { key: 'separate', group: 'bills', icon: 'add-circle-outline', label: tr('ops.TablesScreen.start_a_separate_bill'), description: tr('ops.TablesScreen.another_party_pays_on_its_own'),
          onPress: () => router.push({ pathname: '/pos', params: { table: t.id, bill: 'new' } }) }
        : { key: 'start', group: 'bills', icon: 'add-circle-outline', label: tr('ops.TablesScreen.start_order'), onPress: () => open(t) });
      if (busy) {
        const movable = bills.some((b) => b.status !== 'placed');
        const otherBills = tables.some((x) => x.id !== t.id && billsOf(x).length > 0) || bills.length > 1;
        items.push({ key: 'move', group: 'floor', icon: 'swap-horizontal', label: bills.length > 1 ? tr('ops.TablesScreen.move_a_bill') : tr('ops.TablesScreen.move_to_another_table'), shortcut: 'M',
          disabled: tables.length < 2 || !movable, disabledReason: tables.length < 2 ? tr('ops.TablesScreen.no_other_tables_x') : tr('ops.TablesScreen.accept_the_qr_order_first_x'),
          onPress: () => setMoveFrom({ table: t, mode: 'move' }) });
        items.push({ key: 'merge', group: 'floor', icon: 'git-merge-outline', label: tr('ops.TablesScreen.merge_into_another_bill'),
          disabled: !otherBills || !movable, disabledReason: !movable ? tr('ops.TablesScreen.accept_the_qr_order_first_x') : tr('ops.TablesScreen.no_other_running_bill_to_merge_into_x'),
          onPress: () => setMoveFrom({ table: t, mode: 'merge' }) });
        bills.filter((b) => b.status !== 'placed').forEach((b, i) => {
          items.push({ key: `print-${b.id}`, group: 'floor', icon: 'print-outline', label: bills.length > 1 ? tr('ops.TablesScreen.print_billname', { billName: billName(b, i) }) : tr('common.print_bill'), onPress: () => void printTableBill(t, b) });
        });
      }
    }
    if (manager) {
      items.push({ key: 'waiter', group: 'manage', icon: 'person-outline', label: tr('ops.TablesScreen.assign_waiter'),
        description: t.assigned_staff_name ?? undefined, onPress: () => setWaiterFor(t) });
      items.push({ key: 'qr', group: 'manage', icon: 'qr-code-outline', label: tr('ops.TablesScreen.print_qr_code'), onPress: () => void printOneQr(t) });
      items.push({ key: 'edit', group: 'manage', icon: 'create-outline', label: tr('ops.TablesScreen.edit_table'), onPress: () => { setEditing(t); setFormOpen(true); } });
      items.push({ key: 'remove', group: 'danger', icon: 'trash-outline', label: tr('ops.TablesScreen.remove_table_2'), danger: true,
        disabled: busy, disabledReason: tr('ops.TablesScreen.close_the_running_bill_first_x'), onPress: () => void removeTable(t) });
    }
    return items;
  }, [byId, canOrder, manager, tables, sym, openBill, open, printTableBill, printOneQr, removeTable]);

  if (settings?.business_type === 'retail') {
    return (
      <Screen title={tr('common.tables')}>
        <EmptyState icon="grid-outline" title={tr('ops.TablesScreen.tables_are_for_restaurants')}
          message={tr('ops.TablesScreen.your_business_is_set_up_as_a_retail_store')}
          action={{ label: tr('ops.TablesScreen.go_to_billing'), onPress: () => router.push('/pos'), icon: 'receipt-outline' }} />
      </Screen>
    );
  }

  const compact = size === 'compact';
  const minTile = compact ? (isPhone ? 104 : 128) : (isPhone ? 150 : 184);

  const filters = [
    { key: 'all', label: tr('common.all'), count: counts.all },
    { key: 'free', label: tr('common.free'), count: counts.free, icon: 'ellipse-outline' as const },
    { key: 'occupied', label: tr('ops.TablesScreen.occupied'), count: counts.occupied, icon: 'restaurant-outline' as const },
    { key: 'ready', label: tr('ops.TablesScreen.ready_to_serve'), count: counts.ready, icon: 'notifications-outline' as const },
    { key: 'payment', label: tr('ops.TablesScreen.waiting_payment'), count: counts.payment, icon: 'wallet-outline' as const },
  ];

  const toolbar = tables.length ? (
    <View style={{ gap: 10 }}>
      <FilterBar onSearch={setQuery} searchPlaceholder={tr('ops.TablesScreen.table_customer_or_bill_no_x')} filters={filters} value={filter}
        onChange={(k) => setFilter(k as TableFilter)} />
      {realSections.length > 1 ? (
        <ChipRow>
          <Chip label={tr('ops.TablesScreen.all_sections')} count={`${occupied.length}/${tables.length}`} selected={!section} onPress={() => setSection(null)} icon="layers-outline" />
          {realSections.map((s) => (
            <Chip key={s.name} label={s.name} count={`${s.busy}/${s.total}`} selected={section === s.name} onPress={() => setSection(section === s.name ? null : s.name)} />
          ))}
        </ChipRow>
      ) : null}
    </View>
  ) : undefined;

  return (
    <Screen
      title={tr('common.tables')}
      subtitle={tables.length
        ? tr('ops.TablesScreen.length_of_length2_occupied_v_v2', { length: occupied.length, length2: tables.length, v: occupied.length ? tr('ops.TablesScreen.money_running', { money: money(runningTotal, sym, true) }) : '', v2: readyLines ? tr('ops.TablesScreen.readylines_ready_to_serve', { readyLines }) : '' })
        : undefined}
      onRefresh={reload}
      maxWidth={isDesktop ? 2400 : 1280}
      actions={
        <>
          {tables.length && !isPhone ? (
            <IconButton icon={compact ? 'apps-outline' : 'grid-outline'} variant="secondary"
              accessibilityLabel={compact ? tr('ops.TablesScreen.show_large_tiles') : tr('ops.TablesScreen.show_compact_tiles')} onPress={() => setSize(compact ? 'large' : 'compact')} />
          ) : null}
          {manager && tables.length ? <Button title={isPhone ? undefined : tr('ops.TablesScreen.qr_codes')} accessibilityLabel={tr('ops.TablesScreen.table_qr_codes')} icon="qr-code-outline" variant="outline" onPress={() => setQrOpen(true)} /> : null}
          {manager ? <Button title={isPhone ? tr('common.add') : tr('ops.TablesScreen.add_table')} icon="add" onPress={() => { setEditing(null); setFormOpen(true); }} /> : null}
        </>
      }
      toolbar={toolbar}
    >
      {manager && settings && !settings.qr_ordering_enabled && tables.length ? (
        <Notice tone="neutral" icon="qr-code-outline" title={tr('ops.TablesScreen.qr_ordering_is_off')}
          message={tr('ops.TablesScreen.guests_can_scan_a_table_qr_to_see_your')}
          action={{ label: tr('ops.TablesScreen.open_settings'), onPress: () => router.push('/settings') }} />
      ) : null}

      {loading && !data ? (
        <Grid minItemWidth={minTile} gap={10} maxColumns={16}>
          {Array.from({ length: isPhone ? 9 : 18 }, (_, i) => <Skeleton key={i} height={compact ? 116 : 144} radius={12} />)}
        </Grid>
      ) : null}
      {error && !data ? <ErrorState message={error} onRetry={reload} /> : null}

      {data && !tables.length ? (
        <EmptyState icon="grid-outline" title={tr('common.no_tables_yet')}
          message={manager ? tr('ops.TablesScreen.add_your_tables_to_see_the_floor_at_a') : tr('ops.TablesScreen.ask_a_manager_to_add_tables_in_this_screen')}
          action={manager ? { label: tr('common.add_tables'), onPress: () => { setEditing(null); setFormOpen(true); }, icon: 'add' } : undefined} />
      ) : null}

      {data && tables.length ? (
        <View style={styles.statusRow}>
          <LiveStatus updatedAt={poll.updatedAt} error={error} paused={!poll.live} intervalLabel="8 s" />
          <Legend />
        </View>
      ) : null}

      {data && tables.length && !visible.length ? (
        <EmptyState icon="funnel-outline" title={q ? tr('ops.TablesScreen.no_table_matches') : filter === 'free' ? tr('ops.TablesScreen.every_table_is_busy') : tr('ops.TablesScreen.no_tables_here')}
          action={{ label: tr('ops.TablesScreen.show_all_tables'), onPress: () => { setFilter('all'); setSection(null); } }} />
      ) : null}

      {groups.map(([name, list]) => (
        <View key={name} style={{ gap: 8 }}>
          {realSections.length > 1 && !section ? (
            <GroupTitle title={tr('ops.TablesScreen.name_length_length2_occupied', { name, length: list.filter((x) => x.s.bills.length > 0).length, length2: list.length })} />
          ) : null}
          <Grid minItemWidth={minTile} gap={isPhone ? 8 : 10} maxColumns={16}>
            {list.map(({ t, s }) => (
              <TableTile key={t.id} table={t} s={s} sym={sym} compact={compact} waiter={nameOf(s)} ageLimits={ages.table}
                menu={menuFor(t)} onOpen={() => open(t)} />
            ))}
          </Grid>
        </View>
      ))}

      {data && tables.length ? (
        <Text variant="small" tone="subtle" align="center" style={{ marginTop: 4 }}>
          {tr('ops.TablesScreen.tap_a_table_to_open_it_in_billing')} {isPhone || Platform.OS !== 'web' ? 'long-press' : 'right-click'} {tr('ops.TablesScreen.or_for_move_merge_print_and_more')}
        </Text>
      ) : null}

      <MoveMergeSheet from={moveFrom?.table ?? null} mode={moveFrom?.mode ?? 'move'} tables={tables} onClose={() => setMoveFrom(null)} onDone={refreshAll} />

      <ListSheet visible={!!waiterFor} onClose={() => setWaiterFor(null)} title={waiterFor ? tr('ops.TablesScreen.waiter_for_table_table_number', { table_number: waiterFor.table_number }) : ''}
        subtitle={tr('ops.TablesScreen.new_bills_on_this_table_are_credited_to')}
        actions={waiterActions(waiterFor, staffList, async (staffId) => {
          if (!waiterFor) return;
          try {
            await opsApi.assignWaiter(waiterFor.id, staffId);
            const picked = staffList?.find((x) => x.id === staffId);
            toast.success(staffId ? tr('ops.TablesScreen.table_table_number_v', { table_number: waiterFor.table_number, v: picked?.full_name || picked?.email || 'waiter' }) : tr('ops.TablesScreen.waiter_removed_from_table_table_number', { table_number: waiterFor.table_number }));
            void silentReload();
          } catch (e) {
            toast.error(errorMessage(e));
          }
        })}>
        {staff === 'denied' ? <Notice tone="neutral" message={tr('ops.TablesScreen.your_role_can_t_see_the_staff_list_ask')} /> : null}
        {staff === null && waiterFor ? <Text variant="small" tone="muted">{tr('ops.TablesScreen.loading_staff')}</Text> : null}
      </ListSheet>

      <TableForm visible={formOpen} onClose={() => setFormOpen(false)} editing={editing} sections={sections.map((x) => x.name).filter((n) => n !== NO_SECTION)}
        existing={tables} onSaved={() => void silentReload()} />

      <QrSheet visible={qrOpen} onClose={() => setQrOpen(false)} tables={tables} tenantId={tenantId} businessName={businessName}
        qrEnabled={!!settings?.qr_ordering_enabled} />
    </Screen>
  );
}

type StaffOption = { id: string; full_name: string | null; email: string; role: string; is_active: boolean };

function waiterActions(table: TableInfo | null, staff: StaffOption[] | null,
  assign: (id: string | null) => Promise<void>): MenuAction[] {
  if (!table || !staff) return [];
  const order = (r: string) => (r === 'waiter' ? 0 : r === 'manager' || r === 'owner' ? 2 : 1);
  const list = staff.filter((s) => s.role !== 'kitchen').sort((a, b) => order(a.role) - order(b.role) || (a.full_name ?? '').localeCompare(b.full_name ?? ''));
  return [
    ...list.map((s) => ({
      label: `${s.full_name || s.email}${s.id === table.assigned_staff_id ? '  ✓' : ''}`, icon: 'person-outline' as const,
      subtitle: s.role.charAt(0).toUpperCase() + s.role.slice(1), onPress: () => void assign(s.id),
    })),
    ...(table.assigned_staff_id ? [{ label: tr('ops.TablesScreen.no_waiter'), icon: 'person-remove-outline' as const, onPress: () => void assign(null) }] : []),
  ];
}

function Legend() {
  const { colors } = useTheme();
  const { isPhone } = useLayout();
  if (isPhone) return null;
  const items: [TableState, string][] = [['free', 'Free'], ['occupied', 'Running'], ['ready', 'Food ready'], ['payment', 'Payment'], ['new', 'New QR']];
  return (
    <View style={styles.legend}>
      {items.map(([st, label]) => {
        const c = statusToneColors(colors, STATE_TONE[st]);
        return (
          <View key={st} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: st === 'free' ? colors.surface : c.solid, borderColor: st === 'free' ? colors.borderStrong : c.solid }]} />
            <Text variant="caption" tone="subtle">{label}</Text>
          </View>
        );
      })}
    </View>
  );
}

const TableTile = React.memo(function TableTile({ table, s, sym, compact, waiter, ageLimits, menu, onOpen }: {
  table: TableInfo; s: TableSummary; sym: string; compact: boolean; waiter: string | null; ageLimits: AgeThresholds; menu: ActionMenuItem[]; onOpen: () => void;
}) {
  const menuRef = useRef<ActionMenuHandle>(null);
  const openMenu = useCallback(() => menuRef.current?.open(), []);
  const { colors, radius } = useTheme();
  const { isPhone } = useLayout();
  const busy = s.bills.length > 0;
  const tone = statusToneColors(colors, STATE_TONE[s.state]);
  const age = ageTone(s.minutes, ageLimits);
  const bg = busy ? tone.bg : colors.surface;
  const fg = busy ? tone.fg : colors.text;
  const height = compact ? (isPhone ? 112 : 116) : 144;
  const ini = initials(waiter);
  const a11y = busy
    ? `Table ${table.table_number}, ${STATE_LABEL[s.state]}, ${money(s.total, sym)}, ${formatAge(s.minutes)}${s.guests ? `, ${s.guests} guests` : ''}`
      + `${s.ready ? `, ${s.ready} ready to serve` : ''}${s.upiToConfirm ? ', UPI payment to confirm' : ''}${s.bills.length > 1 ? `, ${s.bills.length} bills` : ''}${waiter ? `, waiter ${waiter}` : ''}`
    : `Table ${table.table_number}, free, ${table.capacity} seats`;

  return (
        <TileBody onPress={onOpen} onMenu={menu.length ? openMenu : undefined} a11y={a11y}
          style={[styles.tile, { height, backgroundColor: bg, borderColor: busy ? tone.solid : colors.border, borderRadius: radius.lg }]}
          hoverStyle={{ borderColor: busy ? tone.fg : colors.borderStrong }}>
          {busy ? <View style={[styles.stripe, { backgroundColor: tone.solid, borderTopLeftRadius: radius.lg, borderBottomLeftRadius: radius.lg }]} /> : null}
          <View style={styles.tileTop}>
            <Text variant={compact ? 'h2' : 'h1'} color={fg} numberOfLines={1} style={styles.tableNo}>{table.table_number}</Text>
            {ini ? <WaiterAvatar initials={ini} name={waiter} size={compact ? 22 : 26} /> : null}
          </View>
          {busy ? (
            <>
              <Text variant={compact ? 'bodyStrong' : 'h3'} color={fg} numberOfLines={1} style={styles.num}>
                {money(s.total, sym, true)}{s.bills.length > 1 ? <Text variant="caption" color={fg}>  {tr('ops.TablesScreen.length_bills', { length: s.bills.length })}</Text> : null}
              </Text>
              <View style={styles.metaRow}>
                <AgeChip minutes={s.minutes} tone={age} />
                {s.guests ? (
                  <View style={styles.guests}>
                    <Ionicons name="people-outline" size={13} color={fg} />
                    <Text variant="caption" color={fg} style={styles.num}>{s.guests}</Text>
                  </View>
                ) : null}
              </View>
              <View style={styles.badges}>
                {s.newQr ? <MiniBadge icon="notifications" label="QR" tone="pending" /> : null}
                {s.ready ? <MiniBadge icon="restaurant" label={`${s.ready}`} tone="ready" a11y={`${s.ready} ready to serve`} /> : null}
                {s.upiToConfirm ? <MiniBadge icon="phone-portrait-outline" label="UPI" tone="waiting" a11y="UPI payment to confirm" /> : null}
                {!compact && s.cooking ? <MiniBadge icon="flame-outline" label={`${s.cooking}`} tone="progress" a11y={`${s.cooking} cooking`} /> : null}
              </View>
            </>
          ) : (
            <View style={[styles.metaRow, { marginTop: 'auto' }]}>
              <Ionicons name="people-outline" size={14} color={colors.textSubtle} />
              <Text variant="small" tone="subtle" numberOfLines={1}>{table.capacity} {tr('ops.TablesScreen.free_2')}</Text>
            </View>
          )}
          {menu.length ? (
            <ActionMenu menuRef={menuRef} items={menu} align="end" style={styles.more}
              title={tr('common.table_table_number_v', { table_number: table.table_number, v: busy ? ` · ${money(s.total, sym, true)} · ${formatAge(s.minutes)}` : tr('ops.TablesScreen.free_3') })}
              trigger={(openIt) => (isPhone ? null : (
                <Pressable onPress={openIt} hitSlop={6} accessibilityRole="button" accessibilityLabel={tr('ops.TablesScreen.more_options_for_table_table_number', { table_number: table.table_number })}
                  style={({ hovered }: any) => [styles.moreBtn, { borderRadius: radius.sm }, hovered && { backgroundColor: colors.surfaceSunken },
                    Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}>
                  <Ionicons name="ellipsis-horizontal" size={16} color={busy ? fg : colors.textSubtle} />
                </Pressable>
              ))} />
          ) : null}
        </TileBody>
  );
});

/** The tile itself: tap opens, long-press (and right-click on web) opens the menu. */
function TileBody({ onPress, onMenu, a11y, style, hoverStyle, children }: {
  onPress: () => void; onMenu?: () => void; a11y: string; style: any; hoverStyle: any; children: React.ReactNode;
}) {
  const ref = useRef<View>(null);
  useContextMenu(ref, onMenu);
  return (
    <Pressable ref={ref} onPress={onPress} onLongPress={onMenu} delayLongPress={350}
      accessibilityRole={Platform.OS === 'web' ? undefined : 'button'} accessibilityLabel={a11y}
      accessibilityHint={onMenu ? tr('ops.TablesScreen.long_press_for_more_options') : undefined}
      style={({ pressed, hovered }: any) => [style, (pressed || hovered) && hoverStyle, pressed && { opacity: 0.9 },
        Platform.OS === 'web' && ({ cursor: 'pointer', userSelect: 'none', transitionDuration: '120ms' } as any)]}>
      {children}
    </Pressable>
  );
}

function MiniBadge({ icon, label, tone, a11y }: { icon: keyof typeof Ionicons.glyphMap; label: string; tone: StatusTone; a11y?: string }) {
  const { colors, radius } = useTheme();
  const c = statusToneColors(colors, tone);
  return (
    <View accessibilityLabel={a11y ?? label} style={[styles.mini, { backgroundColor: c.solid, borderRadius: radius.pill }]}>
      <Ionicons name={icon} size={11} color={tone === 'pending' ? colors.onKitchen : colors.surface} />
      <Text variant="caption" color={tone === 'pending' ? colors.onKitchen : colors.surface} style={styles.miniText}>{label}</Text>
    </View>
  );
}

function MoveMergeSheet({ from, mode, tables, onClose, onDone }: {
  from: TableInfo | null; mode: 'move' | 'merge'; tables: TableInfo[]; onClose: () => void; onDone: () => void;
}) {
  const sym = useData((st) => st.settings?.currency_symbol ?? '₹');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [billId, setBillId] = useState<string | null>(null);
  const bills = from ? billsOf(from).filter((b) => b.status !== 'placed') : [];
  const bill = bills.find((b) => b.id === billId) ?? bills[0] ?? null;
  const others = tables.filter((t) => t.id !== from?.id);
  const free = others.filter((t) => billsOf(t).length === 0);
  const busyTables = others.filter((t) => billsOf(t).length > 0);
  // Merge targets: other running bills on this table and on every other table
  const targets: { table: TableInfo; bill: TableBill; index: number }[] = [];
  if (from) {
    billsOf(from).forEach((b, i) => { if (b.id !== bill?.id && b.status !== 'placed') targets.push({ table: from, bill: b, index: i }); });
    busyTables.forEach((t) => billsOf(t).forEach((b, i) => { if (b.status !== 'placed') targets.push({ table: t, bill: b, index: i }); }));
  }
  const label = (b: TableBill) => (bills.length > 1 ? billName(b, bills.indexOf(b)) : `Table ${from?.table_number}`);
  const close = () => { setBillId(null); onClose(); };

  const move = async (to: TableInfo) => {
    if (!from || !bill) return;
    setBusyId(to.id);
    try {
      await ordersApi.transfer(bill.id, to.id);
      toast.success(tr('ops.TablesScreen.label_table_table_number_v', { label: label(bill), table_number: to.table_number, v: billsOf(to).length ? tr('ops.TablesScreen.as_a_separate_bill') : '' }));
      onDone();
      close();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusyId(null);
    }
  };

  const merge = async (target: { table: TableInfo; bill: TableBill; index: number }) => {
    if (!from || !bill) return;
    const ok = await confirm({
      title: tr('ops.TablesScreen.merge_label_into_table_table_number', { label: label(bill), table_number: target.table.table_number }),
      message: tr('ops.TablesScreen.its_items_and_kitchen_tickets_move_to', { billName: billName(target.bill, target.index), table_number: target.table.table_number, money: money(target.bill.total_amount, sym), label: label(bill) }),
      confirmLabel: tr('ops.TablesScreen.merge_bills'),
    });
    if (!ok) return;
    setBusyId(target.bill.id);
    try {
      await floorApi.merge(target.bill.id, bill.id);
      toast.success(tr('ops.TablesScreen.merged_into_table_table_number', { table_number: target.table.table_number }));
      onDone();
      close();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Sheet visible={!!from} onClose={close} width={560}
      title={from ? (mode === 'move' ? tr('ops.TablesScreen.move_table_table_number', { table_number: from.table_number }) : tr('ops.TablesScreen.merge_from_table_table_number', { table_number: from.table_number })) : ''}
      subtitle={mode === 'move' ? tr('ops.TablesScreen.the_bill_and_its_kitchen_tickets_move')
        : tr('ops.TablesScreen.bring_this_bill_s_items_into_another')}>
      {bills.length > 1 ? (
        <View style={{ gap: 6 }}>
          <Text variant="caption" tone="subtle" style={styles.caps}>{tr('ops.TablesScreen.which_bill')}</Text>
          <ChipRow>
            {bills.map((b, i) => (
              <Chip key={b.id} label={`${billName(b, i)} · ${money(b.total_amount, sym, true)}`} selected={b.id === bill?.id} onPress={() => setBillId(b.id)} />
            ))}
          </ChipRow>
        </View>
      ) : null}
      {mode === 'move' ? (
        <>
          {free.length ? (
            <View style={{ gap: 6 }}>
              <Text variant="caption" tone="subtle" style={styles.caps}>{tr('ops.TablesScreen.free_tables')}</Text>
              <Grid minItemWidth={88} gap={8} maxColumns={8}>
                {free.map((t) => (
                  <Button key={t.id} title={t.table_number} variant="outline" onPress={() => void move(t)} loading={busyId === t.id}
                    disabled={!!busyId || !bill} accessibilityLabel={tr('ops.TablesScreen.move_to_table_table_number', { table_number: t.table_number })} full />
                ))}
              </Grid>
            </View>
          ) : <Text variant="small" tone="muted">{tr('ops.TablesScreen.no_free_tables_right_now')}</Text>}
          {busyTables.length ? (
            <View style={{ gap: 6 }}>
              <Text variant="caption" tone="subtle" style={styles.caps}>{tr('ops.TablesScreen.join_a_busy_table_separate_bill')}</Text>
              <Grid minItemWidth={88} gap={8} maxColumns={8}>
                {busyTables.map((t) => (
                  <Button key={t.id} title={t.table_number} variant="tonal" icon="people-outline" onPress={() => void move(t)} loading={busyId === t.id}
                    disabled={!!busyId || !bill} accessibilityLabel={tr('ops.TablesScreen.move_to_busy_table_table_number_as_a', { table_number: t.table_number })} full />
                ))}
              </Grid>
            </View>
          ) : null}
        </>
      ) : targets.length ? (
        <View style={{ gap: 6 }}>
          <Text variant="caption" tone="subtle" style={styles.caps}>{tr('ops.TablesScreen.merge_into')}</Text>
          {targets.map((x) => (
            <Button key={x.bill.id} variant="outline" icon="git-merge-outline" full loading={busyId === x.bill.id} disabled={!!busyId || !bill}
              title={tr('ops.TablesScreen.table_table_number_billname_money', { table_number: x.table.table_number, billName: billName(x.bill, x.index), money: money(x.bill.total_amount, sym, true) })}
              onPress={() => void merge(x)} style={{ justifyContent: 'flex-start' }} />
          ))}
        </View>
      ) : <Text variant="small" tone="muted">{tr('ops.TablesScreen.no_other_running_bill_to_merge_into')}</Text>}
      {!others.length && mode === 'move' ? <EmptyState icon="grid-outline" title={tr('ops.TablesScreen.no_other_tables')} message={tr('ops.TablesScreen.add_more_tables_to_move_bills_between_them')} /> : null}
    </Sheet>
  );
}

function QrSheet({ visible, onClose, tables, tenantId, businessName, qrEnabled }: {
  visible: boolean; onClose: () => void; tables: TableInfo[]; tenantId: string; businessName: string; qrEnabled: boolean;
}) {
  const { colors, radius } = useTheme();
  const [printing, setPrinting] = useState(false);
  const printAll = async () => {
    setPrinting(true);
    try {
      await printTableQrs(tables, tenantId, businessName);
    } catch (e) {
      toast.error(printErrorMessage(e));
    } finally {
      setPrinting(false);
    }
  };
  const one = async (t: TableInfo) => {
    try {
      await printTableQrs([t], tenantId, businessName);
    } catch (e) {
      toast.error(printErrorMessage(e));
    }
  };
  return (
    <Sheet visible={visible} onClose={onClose} title={tr('ops.TablesScreen.table_qr_codes')} subtitle={tr('ops.TablesScreen.guests_scan_to_see_the_menu_and_order')} width={760}
      footer={
        <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'flex-end' }}>
          <Button title={tr('common.close')} variant="outline" onPress={onClose} />
          <Button title={tr('ops.TablesScreen.print_all_length', { length: tables.length })} icon="print-outline" onPress={printAll} loading={printing} disabled={!tables.length} />
        </View>
      }>
      {!qrEnabled ? (
        <Notice tone="warning" title={tr('ops.TablesScreen.qr_ordering_is_off')} message={tr('ops.TablesScreen.codes_will_open_your_menu_but_guests_can')}
          action={{ label: tr('ops.TablesScreen.open_settings'), onPress: () => { onClose(); router.push('/settings'); } }} />
      ) : null}
      {visible ? (
        <ScrollView style={{ maxHeight: 560 }}>
          <Grid minItemWidth={150} gap={12}>
            {tables.map((t) => (
              <Pressable key={t.id} onPress={() => void one(t)} accessibilityRole="button" accessibilityLabel={tr('ops.TablesScreen.print_qr_code_for_table_table_number', { table_number: t.table_number })}
                style={({ hovered }: any) => [styles.qrCard, { borderColor: hovered ? colors.borderStrong : colors.border, borderRadius: radius.lg, backgroundColor: colors.surfaceAlt }]}>
                <QrCode value={tableOrderUrl(tenantId, t.id)} size={124} margin={3} style={{ borderRadius: radius.sm, overflow: 'hidden' }} />
                <Text variant="h3" numberOfLines={1}>{tr('ops.TablesScreen.table')} {t.table_number}</Text>
                {t.section ? <Text variant="small" tone="subtle" numberOfLines={1}>{t.section}</Text> : null}
                <View style={styles.metaRow}>
                  <Ionicons name="print-outline" size={13} color={colors.textMuted} />
                  <Text variant="caption" tone="muted">{tr('ops.TablesScreen.print')}</Text>
                </View>
              </Pressable>
            ))}
          </Grid>
        </ScrollView>
      ) : null}
      <Text variant="small" tone="subtle">{tr('ops.TablesScreen.tip_print_on_thick_paper_or_laminate_it')}</Text>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap', justifyContent: 'space-between' },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 10, height: 10, borderRadius: 3, borderWidth: 1 },
  tile: { borderWidth: 1.5, paddingVertical: 8, paddingLeft: 12, paddingRight: 8, gap: 3, overflow: 'hidden' },
  stripe: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },
  tileTop: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingRight: 22, flexShrink: 0 },
  tableNo: { flexShrink: 1, flexGrow: 1, fontVariant: ['tabular-nums'] },
  num: { fontVariant: ['tabular-nums'], flexShrink: 0 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0 },
  guests: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  badges: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 'auto', minHeight: 18, flexShrink: 0 },
  mini: { flexDirection: 'row', alignItems: 'center', gap: 2, height: 18, paddingHorizontal: 6 },
  miniText: { fontSize: 11, lineHeight: 14, letterSpacing: 0, fontVariant: ['tabular-nums'] },
  more: { position: 'absolute', top: 4, right: 4, width: 28, height: 28 },
  moreBtn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  caps: { textTransform: 'uppercase' },
  qrCard: { borderWidth: 1, padding: 12, alignItems: 'center', gap: 6 },
});
