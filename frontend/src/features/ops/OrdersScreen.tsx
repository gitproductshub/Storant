/**
 * Orders: tens of thousands of bills (docs/20_High_Volume_UX.md §2–3).
 * - DataList: a table on wide screens, cards on phones; server-paged (50 a page) and virtualised.
 * - FilterBar: debounced server search (bill no, phone, name, aggregator id), status chips with server counts,
 *   date presets and channel in anchored menus.
 * - Detail opens in a side panel on tablet/desktop (the list stays visible) and full screen on phones.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import {
  ActionMenu, Button, DataList, FilterBar, IconButton, Screen, Sheet, StatusPill, Text, toast, useHotkeys,
  type ActionMenuItem, type DataColumn,
} from '@/components/ui';
import type { Order } from '@/api/types';
import { summaryFromOrder, type OrderSummaryRow } from '@/api/floor';
import { ordersApi } from '@/api/endpoints';
import { useAuth, can } from '@/store/auth';
import { useData } from '@/store/data';
import { useAccessInfo } from '@/store/access';
import { printBill, printErrorMessage } from '@/lib/billing';
import { formatDate, formatTime, money } from '@/lib/format';
import { ORDER_TYPE_UI } from '@/lib/uiLabels';
import { ChannelTile, billNo, channelLabel } from './common';
import { OrderDetail } from './OrderDetail';
import { OfflineBills } from './OfflineBills';
import { usePagedOrders, type OrderQuery } from './usePagedOrders';
import {
  DATE_PRESETS, ORDER_STATUS_FILTERS, datePresetRange, paymentPillStatus, type DatePreset, type OrderStatusFilter,
} from './floorLogic';
import { t, currentLocale } from '@/i18n';

const PANEL_MIN_WIDTH = 900;

type Row = OrderSummaryRow;

function whereLabel(o: Row): string {
  if (o.table_label) return `Table ${o.table_label}${o.bill_label ? ` · ${o.bill_label}` : ''}`;
  if (o.channel !== 'POS') return `${channelLabel(o.channel)}${o.external_order_id ? ` · ${o.external_order_id}` : ''}`;
  return `${ORDER_TYPE_UI[o.type] ?? o.type}${o.token_no ? ` · Token ${o.token_no}` : ''}`;
}

function whenLabel(iso: string): string {
  const today = new Date().toDateString() === new Date(iso).toDateString();
  return today ? formatTime(iso) : `${formatDate(iso)}, ${formatTime(iso)}`;
}

export default function OrdersScreen() {
  const { colors } = useTheme();
  const { isPhone, isDesktop, width } = useLayout();
  const role = useAuth((s) => s.session?.role ?? null);
  const access = useAccessInfo();
  const isOwner = role === 'owner' || !!(access as { is_owner?: boolean } | null)?.is_owner;
  const channels = useData((s) => s.channels);
  const settings = useData((s) => s.settings);
  const sym = settings?.currency_symbol ?? '₹';

  const [status, setStatus] = useState<OrderStatusFilter>('all');
  const [date, setDate] = useState<DatePreset>('today');
  const [channel, setChannel] = useState<string | null>(null);
  const [archived, setArchived] = useState(false);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Row | null>(null);

  const base = useMemo<Omit<OrderQuery, 'status'>>(() => {
    const r = q ? {} : datePresetRange(date); // searching looks across all dates
    return { channel: channel ?? undefined, q: q || undefined, date_from: r.from, date_to: r.to, include_archived: archived || undefined };
  }, [date, channel, q, archived]);
  const query = useMemo<OrderQuery>(() => ({ ...base, status: status === 'all' ? undefined : status }), [base, status]);
  const list = usePagedOrders(query);
  const counts = list.counts;

  const channelOptions = useMemo(() => {
    const enabled = channels.filter((c) => c.enabled).map((c) => c.code as string);
    const codes = Array.from(new Set(['POS', ...enabled]));
    return codes.length > 1 ? codes : ['POS', 'QR', 'ONLINE', 'SWIGGY', 'ZOMATO'];
  }, [channels]);

  const panel = !isPhone && width >= PANEL_MIN_WIDTH - 140; // tablets in portrait still get the side panel
  const filtersActive = status !== 'all' || date !== 'today' || channel !== null || !!q || archived;
  const clearFilters = () => { setStatus('all'); setDate('today'); setChannel(null); setQ(''); setArchived(false); };

  const onStatus = (k: string) => {
    const v = k as OrderStatusFilter;
    setStatus(v);
    // Running bills can be from any day; finished ones are usually looked up by day
    if (v === 'active' || v === 'placed') setDate('any');
    else if (date === 'any' && (status === 'active' || status === 'placed')) setDate('today');
  };

  const { replace, refreshSilently } = list;
  const onChanged = useCallback((o: Order) => {
    replace(o);
    setSelected((s) => (s && s.id === o.id ? summaryFromOrder(s, o) : s));
    void refreshSilently(); // status counts
  }, [replace, refreshSilently]);

  useHotkeys({ Escape: () => { if (!selected) return false; setSelected(null); } }, [selected]);

  const reprint = useCallback(async (o: Row) => {
    try {
      const full = await ordersApi.get(o.id); // list rows are light (no lines)
      await printBill(full, settings, { duplicate: full.status === 'completed' });
    } catch (e) {
      toast.error(printErrorMessage(e));
    }
  }, [settings]);

  const rowMenu = useCallback((o: Row): ActionMenuItem[] => [
    { key: 'open', label: t('ops.OrdersScreen.view_bill'), icon: 'document-text-outline', onPress: () => setSelected(o) },
    { key: 'print', label: o.status === 'completed' ? t('ops.OrdersScreen.reprint') : t('common.print_bill'), icon: 'print-outline', hidden: o.status === 'merged', onPress: () => void reprint(o) },
    { key: 'pos', label: o.payment_status !== 'paid' && can(role, 'bill') ? t('ops.OrdersScreen.settle_in_billing') : t('common.open_in_billing'), icon: 'receipt-outline',
      hidden: o.status !== 'open' || !can(role, 'order'), onPress: () => router.push({ pathname: '/pos', params: { order: o.id } }) },
    { key: 'online', label: t('ops.OrdersScreen.review_in_online_orders'), icon: 'bicycle-outline', hidden: o.status !== 'placed', onPress: () => router.push('/online') },
  ], [reprint, role]);

  const columns = useMemo<DataColumn<Row>[]>(() => [
    { key: 'time', title: t('ops.OrdersScreen.time'), width: date === 'today' && !q ? 88 : 140, value: (o) => whenLabel(o.created_at) },
    { key: 'bill', title: t('common.bill'), flex: 1, minWidth: 110,
      render: (o) => <Text variant="smallStrong" numberOfLines={1} style={o.status === 'cancelled' ? styles.strike : undefined}>{billNo(o)}</Text> },
    { key: 'where', title: t('ops.OrdersScreen.table_channel'), flex: 1.4, minWidth: 140, hideBelow: 720, value: whereLabel },
    { key: 'customer', title: t('common.customer'), flex: 1.2, minWidth: 120, hideBelow: 880, value: (o) => o.customer_name || o.customer_phone || '—' },
    { key: 'items', title: t('common.items'), width: 64, numeric: true, hideBelow: 1180, value: (o) => (o.item_count ? String(o.item_count) : '—') },
    { key: 'waiter', title: t('common.waiter'), width: 120, hideBelow: 1080, value: (o) => o.waiter_name || '—' },
    { key: 'amount', title: t('common.amount'), width: 108, numeric: true,
      render: (o) => (
        <Text variant="smallStrong" numberOfLines={1} style={[styles.num, o.status === 'cancelled' && styles.strike]} tone={o.status === 'cancelled' ? 'subtle' : 'default'}>
          {money(o.total_amount, sym)}
        </Text>
      ) },
    { key: 'payment', title: t('ops.OrdersScreen.payment'), width: 116, hideBelow: 620,
      render: (o) => { const p = paymentPillStatus(o); return p ? <StatusPill status={p} label={p === 'claim' ? t('ops.OrdersScreen.upi_claim') : undefined} /> : null; } },
    { key: 'status', title: t('common.status'), width: 118, render: (o) => <StatusPill status={o.status} /> },
  ], [sym, date, q]);

  const renderCard = useCallback((o: Row) => {
    const p = paymentPillStatus(o);
    return (
      <View style={styles.card}>
        <ChannelTile code={o.channel} size={36} />
        <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
          <View style={styles.cardTop}>
            <Text variant="bodyStrong" numberOfLines={1} style={[{ flexShrink: 1 }, o.status === 'cancelled' && styles.strike]}>{billNo(o)}</Text>
            {o.status !== 'completed' && o.status !== 'open' ? <StatusPill status={o.status} /> : null}
          </View>
          <Text variant="small" tone="muted" numberOfLines={1}>
            {[whenLabel(o.created_at), whereLabel(o), o.item_count ? `${o.item_count} item${o.item_count === 1 ? '' : 's'}` : null,
              o.customer_name || o.customer_phone].filter(Boolean).join(' · ')}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <Text variant="money" numberOfLines={1} style={o.status === 'cancelled' ? [styles.strike, { color: colors.textSubtle }] : undefined}>{money(o.total_amount, sym)}</Text>
          {p ? <StatusPill status={p} label={p === 'claim' ? t('ops.OrdersScreen.upi_claim') : undefined} /> : null}
        </View>
      </View>
    );
  }, [sym, colors.textSubtle]);

  const rowActions = useCallback((o: Row) => <ActionMenu items={rowMenu(o)} align="end" title={t('ops.OrdersScreen.bill_billno', { billNo: billNo(o) })} />, [rowMenu]);

  const dateLabel = q ? 'All dates' : DATE_PRESETS.find((d) => d.key === date)?.label ?? 'Today';
  const dateMenu = (
    <ActionMenu align="end" title={t('ops.OrdersScreen.date')}
      items={DATE_PRESETS.map((d) => ({ key: d.key, label: d.label, selected: !q && date === d.key, onPress: () => setDate(d.key) }))}
      trigger={(open) => <Button title={isPhone ? undefined : dateLabel} icon="calendar-outline" iconRight={isPhone ? undefined : 'chevron-down'} size={isPhone ? 'md' : 'sm'}
        variant={date !== 'today' && !q ? 'tonal' : 'outline'} onPress={open} accessibilityLabel={t('ops.OrdersScreen.date_datelabel', { dateLabel })} />} />
  );
  const channelMenu = (
    <ActionMenu align="end" title={t('common.channel')} width={240}
      items={[
        { key: 'all', label: t('ops.OrdersScreen.all_channels'), selected: channel === null, onPress: () => setChannel(null), group: 'ch' },
        ...channelOptions.map((c) => ({ key: c, label: channelLabel(c), selected: channel === c, onPress: () => setChannel(c), group: 'ch' })),
        { key: 'archived', label: archived ? t('ops.OrdersScreen.hide_archived_bills') : t('ops.OrdersScreen.include_archived_bills'), icon: 'archive-outline' as const, group: 'opts',
          hidden: !isOwner, selected: archived, onPress: () => setArchived(!archived) },
      ]}
      trigger={(open) => <Button title={isPhone ? undefined : channel ? channelLabel(channel) : t('ops.OrdersScreen.all_channels')} icon="funnel-outline"
        iconRight={isPhone ? undefined : 'chevron-down'} size={isPhone ? 'md' : 'sm'} variant={channel || archived ? 'tonal' : 'outline'} onPress={open}
        accessibilityLabel={t('ops.OrdersScreen.channel_v', { v: channel ? channelLabel(channel) : 'all' })} />} />
  );

  const filters = ORDER_STATUS_FILTERS
    .filter((f) => !f.optional || status === f.key || (counts[f.key] ?? 0) > 0)
    .map((f) => ({ key: f.key, label: f.label, count: counts.all === undefined ? undefined : counts[f.key] ?? 0 }));

  const listView = (
    <View style={{ flex: 1, minWidth: 0, gap: 10 }}>
      <OfflineBills />
      <View style={styles.summary}>
        <Text variant="small" tone="muted" numberOfLines={1} style={{ flex: 1 }}>
          {list.loading ? t('ops.OrdersScreen.loading') : t('ops.OrdersScreen.tolocalestring_bill_v_v2', { toLocaleString: list.total.toLocaleString(currentLocale()), v: list.total === 1 ? '' : 's', v2: q ? t('ops.OrdersScreen.matching_q', { q }) : ` · ${dateLabel.toLowerCase()}` })}
          {!list.loading && list.items.length < list.total ? t('ops.OrdersScreen.showing_tolocalestring', { toLocaleString: list.items.length.toLocaleString(currentLocale()) }) : ''}
        </Text>
        {filtersActive ? <Button title={t('common.clear_filters')} size="sm" variant="ghost" onPress={clearFilters} /> : null}
      </View>
      <DataList<Row>
        data={list.items}
        keyExtractor={(o) => o.id}
        columns={columns}
        renderCard={renderCard}
        cardHeight={76}
        tableMinWidth={640}
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
        empty={{
          icon: 'receipt-outline',
          title: q ? t('ops.OrdersScreen.no_matching_bills') : status === 'active' ? t('ops.OrdersScreen.no_running_orders') : t('ops.OrdersScreen.no_orders_here_yet'),
          message: q ? t('ops.OrdersScreen.try_a_bill_number_the_last_digits_of_a')
            : filtersActive ? t('ops.OrdersScreen.nothing_matches_these_filters_try_another') : t('ops.OrdersScreen.bills_you_create_in_billing_show_up_here'),
          action: filtersActive ? { label: t('common.clear_filters'), onPress: clearFilters, icon: 'funnel-outline' }
            : can(role, 'order') ? { label: t('common.new_bill'), onPress: () => router.push('/pos'), icon: 'add' } : undefined,
        }}
        refreshing={list.refreshing}
        onRefresh={() => void list.reload()}
        onEndReached={list.loadMore}
        loadingMore={list.loadingMore}
        hasMore={list.hasMore}
        onPressRow={(o) => setSelected(o)}
        openKey={selected?.id ?? null}
        highlightKeys={list.fresh}
        rowActions={isDesktop ? rowActions : undefined}
        rowActionsWidth={52}
        keyboard={Platform.OS === 'web'}
        extraData={selected?.id}
      />
    </View>
  );

  return (
    <Screen title={t('common.orders')} scroll={false} maxWidth={2400}
      toolbar={
        <FilterBar onSearch={setQ} search={q} searchPlaceholder={isPhone ? t('ops.OrdersScreen.bill_no_phone_or_name_x') : t('ops.OrdersScreen.bill_no_phone_name_or_aggregator_id_x')}
          searching={list.loading && !!q} filters={filters} value={status} onChange={onStatus}
          right={<>{dateMenu}{channelMenu}</>} />
      }
      actions={can(role, 'order') ? <Button title={isPhone ? t('common.new') : t('common.new_bill')} icon="add" onPress={() => router.push('/pos')} /> : undefined}
      contentStyle={{ flex: 1, paddingBottom: 12 }}>
      {panel ? (
        <View style={styles.split}>
          {listView}
          {selected ? (
            <View style={[styles.pane, { width: width >= 1400 ? 460 : 400, backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={[styles.paneHead, { borderBottomColor: colors.divider }]}>
                <Text variant="h3" style={{ flex: 1 }} numberOfLines={1}>{t('ops.OrdersScreen.bill_details')}</Text>
                <IconButton icon="close" accessibilityLabel={t('ops.OrdersScreen.close_bill_details')} onPress={() => setSelected(null)} />
              </View>
              <ScrollView contentContainerStyle={{ padding: 16 }}>
                <OrderDetail key={selected.id} orderId={selected.id} onChanged={onChanged} />
              </ScrollView>
            </View>
          ) : null}
        </View>
      ) : (
        <>
          {listView}
          <Sheet visible={!!selected} onClose={() => setSelected(null)} width={620} title={t('ops.OrdersScreen.bill_details')}>
            {selected ? (
              <OrderDetail key={selected.id} orderId={selected.id} onClose={() => setSelected(null)} onChanged={onChanged} />
            ) : null}
          </Sheet>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  summary: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 32 },
  split: { flex: 1, flexDirection: 'row', gap: 16, minHeight: 0 },
  pane: { borderWidth: 1, borderRadius: 14, overflow: 'hidden' },
  paneHead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 16, paddingRight: 6, height: 52, borderBottomWidth: 1 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 },
  num: { fontVariant: ['tabular-nums'] },
  strike: { textDecorationLine: 'line-through' },
});
