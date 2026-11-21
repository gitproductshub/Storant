/** Team tab: staff list with role badges, active switches, add/edit sheet, plan limit and table assignment. */
import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, Switch, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { errorMessage } from '@/api/client';
import { teamApi, type AssignableTable, type StaffAccount } from '@/api/access';
import { Badge, Button, DataList, FilterBar, Text, confirm, toast, type DataColumn } from '@/components/ui';
import { useApi } from '@/hooks/useApi';
import { useNet } from '@/lib/sync';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { Callout } from '../components';
import { ShareLoginSheet, StaffSheet, roleTakesOrders } from './StaffSheet';
import { Avatar, RoleBadge, canManageRole, roleName, type StaffCtx } from './shared';
import { brand } from '@/config/brand';
import { t as tr } from '@/i18n';

type SheetState = { mode: 'add' } | { mode: 'edit'; member: StaffAccount } | { mode: 'share'; email: string; password: string; name: string } | null;

const ROLE_ORDER = ['owner', 'manager', 'cashier', 'waiter', 'kitchen'];

export function TeamTab({ ctx, refreshKey }: { ctx: StaffCtx; refreshKey: number }) {
  const { isPhone } = useLayout();
  const { colors, radius } = useTheme();
  const online = useNet((s) => s.online && s.serverReachable);
  const staffQ = useApi(() => teamApi.staff(), [refreshKey]);
  const tablesUsed = ctx.hasFeature('tables') && ctx.can('tables.view');
  const tablesQ = useApi(() => (tablesUsed ? teamApi.tables() : Promise.resolve([] as AssignableTable[])), [tablesUsed, refreshKey]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<string>('all');
  const [sheet, setSheet] = useState<SheetState>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const roles = ctx.roles ?? [];
  const tables = tablesQ.data ?? [];
  // Older servers don't send `assigned_staff_id`; hide the picker instead of silently doing nothing.
  const assignSupported = tables.some((t) => 'assigned_staff_id' in t);
  const canAssignTables = tablesUsed && ctx.can('tables.manage');

  const staff = useMemo(() => {
    const order = (key: string) => { const i = ROLE_ORDER.indexOf(key); return i >= 0 ? i : 50; };
    return [...(staffQ.data ?? [])].sort((a, b) => Number(b.is_active) - Number(a.is_active) || order(a.role) - order(b.role)
      || (a.full_name ?? a.email).localeCompare(b.full_name ?? b.email));
  }, [staffQ.data]);
  const staffNames = useMemo(() => new Map(staff.map((s) => [s.id, s.full_name || s.email])), [staff]);
  const tablesByStaff = useMemo(() => {
    const map = new Map<string, AssignableTable[]>();
    for (const t of tables) if (t.assigned_staff_id) map.set(t.assigned_staff_id, [...(map.get(t.assigned_staff_id) ?? []), t]);
    return map;
  }, [tables]);

  const activeCount = staff.filter((s) => s.is_active).length;
  const limit = ctx.access?.plan.limits.max_staff ?? null;
  const atLimit = limit !== null && activeCount >= limit;
  const roleCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of staff) if (s.is_active) m.set(s.role, (m.get(s.role) ?? 0) + 1);
    return m;
  }, [staff]);
  const filterRoles = useMemo(() => {
    const keys = [...roleCounts.keys()];
    return keys.sort((a, b) => {
      const ia = ROLE_ORDER.indexOf(a), ib = ROLE_ORDER.indexOf(b);
      return (ia < 0 ? 50 : ia) - (ib < 0 ? 50 : ib) || a.localeCompare(b);
    });
  }, [roleCounts]);

  const q = query.trim().toLowerCase();
  const visible = staff.filter((s) => {
    if (filter === 'inactive' ? s.is_active : filter !== 'all' && (s.role !== filter || !s.is_active)) return false;
    if (!q) return true;
    return (s.full_name ?? '').toLowerCase().includes(q) || s.email.toLowerCase().includes(q) || s.role_name.toLowerCase().includes(q);
  });

  const upsert = (m: StaffAccount) => staffQ.setData((list) => (list ? (list.some((x) => x.id === m.id) ? list.map((x) => (x.id === m.id ? m : x)) : [...list, m]) : [m]));
  const isSelf = (m: StaffAccount) => m.id === ctx.myStaffId || m.email.toLowerCase() === ctx.myEmail;
  const manageable = (m: StaffAccount) => canManageRole(ctx.isOwner, ctx.canManageStaff, m.role);

  const toggleActive = async (m: StaffAccount, next: boolean) => {
    const label = m.full_name || m.email;
    if (!next) {
      const ok = await confirm({
        title: tr('settings.staff_TeamTab.deactivate_label', { label }),
        message: tr('settings.staff_TeamTab.they_can_t_sign_in_again_a_device_that_is'),
        confirmLabel: tr('common.deactivate'), danger: true,
      });
      if (!ok) return;
    }
    setBusyId(m.id);
    try {
      upsert(await teamApi.updateStaff(m.id, { is_active: next }));
      toast.success(next ? tr('settings.staff_TeamTab.label_can_sign_in_again', { label }) : tr('settings.staff_TeamTab.label_deactivated', { label }));
      ctx.reloadRoles(); // staff counts per role changed
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusyId(null);
    }
  };

  const tableLabel = (m: StaffAccount) => {
    const list = tablesByStaff.get(m.id);
    if (!list?.length) return null;
    const names = list.map((t) => t.table_number);
    return names.length > 6 ? `${names.slice(0, 6).join(', ')} +${names.length - 6}` : names.join(', ');
  };

  const activeControl = (m: StaffAccount) => {
    if (busyId === m.id) return <ActivityIndicator color={colors.primary} />;
    if (!manageable(m) || isSelf(m)) {
      return m.is_active ? <Badge label={tr('common.active')} tone="success" /> : <Badge label={tr('common.off')} tone="neutral" />;
    }
    // Own press target so toggling doesn't also open the row's edit sheet.
    return (
      <Pressable onPress={() => undefined} accessible={false} style={{ padding: 4 }}>
        <Switch value={m.is_active} onValueChange={(v) => void toggleActive(m, v)} disabled={!online}
          trackColor={{ true: colors.primary, false: colors.borderStrong }} thumbColor={colors.surface}
          accessibilityLabel={tr('settings.staff_TeamTab.v_login_active', { v: m.full_name || m.email })} />
      </Pressable>
    );
  };

  const nameCell = (m: StaffAccount) => {
    const name = m.full_name || m.email;
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
        <Avatar name={name} active={m.is_active} size={34} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text variant="bodyStrong" tone={m.is_active ? 'default' : 'muted'} numberOfLines={1} style={{ flexShrink: 1 }}>{name}</Text>
            {isSelf(m) ? <Badge label={tr('settings.staff_TeamTab.you')} tone="success" /> : null}
          </View>
          <Text variant="small" tone="muted" numberOfLines={1}>{m.email}</Text>
        </View>
      </View>
    );
  };

  const showTables = tablesUsed && assignSupported;
  const columns = useMemo<DataColumn<StaffAccount>[]>(() => [
    { key: 'name', title: tr('common.name'), flex: 2.4, render: nameCell },
    { key: 'role', title: tr('common.role'), flex: 1.3, render: (m) => <RoleBadge roleKey={m.role} label={m.role_name} muted={!m.is_active} /> },
    ...(showTables ? [{ key: 'tables', title: tr('common.tables'), flex: 1.2, hideBelow: 760, render: (m: StaffAccount) => {
      const t = tableLabel(m);
      return t ? <Text variant="small" numberOfLines={1}>{t}</Text>
        : <Text variant="small" tone="subtle">{roleTakesOrders(m.role, ctx.roles) && m.is_active ? tr('common.none') : '—'}</Text>;
    } } as DataColumn<StaffAccount>] : []),
    { key: 'active', title: tr('common.active'), width: 84, align: 'center', render: activeControl },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [showTables, tablesByStaff, busyId, online, ctx.roles, ctx.myStaffId, ctx.myEmail, ctx.isOwner, ctx.canManageStaff, colors]);

  const renderCard = useCallback((m: StaffAccount) => {
    const t = tableLabel(m);
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
          {nameCell(m)}
          <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', paddingLeft: 44 }}>
            <RoleBadge roleKey={m.role} label={m.role_name} muted={!m.is_active} />
            {t ? <Text variant="caption" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>{tr('common.tables')} {t}</Text> : null}
          </View>
        </View>
        {activeControl(m)}
      </View>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tablesByStaff, busyId, online, ctx.myStaffId, ctx.myEmail, ctx.isOwner, ctx.canManageStaff, colors]);

  const filters = useMemo(() => [
    { key: 'all', label: tr('common.everyone'), count: activeCount },
    ...filterRoles.map((key) => ({ key, label: roleName(key, roles), count: roleCounts.get(key) })),
    ...(staff.length > activeCount ? [{ key: 'inactive', label: tr('settings.staff_TeamTab.deactivated'), icon: 'moon-outline' as const, count: staff.length - activeCount }] : []),
  ], [activeCount, filterRoles, roles, roleCounts, staff.length]);

  const openMember = useCallback((m: StaffAccount) => {
    if (manageable(m)) setSheet({ mode: 'edit', member: m });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.isOwner, ctx.canManageStaff]);

  const loading = staffQ.loading && !staffQ.data;
  const notes = [
    ctx.canManageStaff && !ctx.isOwner ? 'You can add and change everyone except owners and managers. Only the owner can change those logins.' : null,
    !ctx.canManageStaff ? 'You can see the team. Ask the owner or a manager to add or change logins.' : null,
  ].filter(Boolean) as string[];

  const addButton = ctx.canManageStaff ? (
    <Button title={isPhone ? tr('common.add') : tr('settings.staff_TeamTab.add_staff')} icon="person-add-outline" onPress={() => setSheet({ mode: 'add' })}
      disabled={atLimit || !online || roles.length === 0}
      disabledReason={atLimit ? tr('settings.staff_TeamTab.your_plan_limit_is_reached_x') : !online ? tr('settings.staff_TeamTab.you_are_offline_x') : tr('settings.staff_TeamTab.roles_are_still_loading_x')} />
  ) : null;

  return (
    <View style={{ gap: 12, flex: 1, minHeight: 0 }}>
      {notes.map((n) => <Callout key={n} tone="neutral" icon="shield-checkmark-outline">{n}</Callout>)}
      {ctx.canManageStaff && atLimit ? (
        <Callout tone="warning" icon="lock-closed-outline" title={tr('settings.staff_TeamTab.your_v_plan_allows_up_to_limit_active', { v: ctx.access?.plan.name ?? '', limit })}>
          {tr('settings.staff_TeamTab.deactivate_someone_who_has_left_or', { brand: brand.name })}
        </Callout>
      ) : null}
      {ctx.rolesError && !ctx.roles ? (
        <Callout tone="warning" action={<Button title={tr('common.try_again')} size="sm" variant="outline" icon="refresh" onPress={ctx.reloadRoles} />}>
          {tr('settings.staff_TeamTab.roles_couldn_t_be_loaded_roleserror', { rolesError: ctx.rolesError })}
        </Callout>
      ) : null}
      {staffQ.data && staff.length <= 1 ? (
        <Callout tone="info" icon="people-outline" title={tr('settings.staff_TeamTab.only_you_so_far')}>
          {tr('settings.staff_TeamTab.add_your_cashiers_waiters_and_kitchen')}
        </Callout>
      ) : null}

      <FilterBar
        onSearch={setQuery}
        searchPlaceholder={tr('settings.staff_TeamTab.name_email_or_role_x')}
        filters={staff.length > 1 ? filters : undefined}
        value={filter}
        onChange={setFilter}
        right={addButton}
      />
      {staffQ.data ? (
        <Text variant="small" tone="muted">
          {activeCount}{limit !== null ? tr('settings.staff_TeamTab.of_limit', { limit }) : ''} {tr('settings.staff_TeamTab.active_login')}{activeCount === 1 ? '' : 's'}
          {staff.length > activeCount ? tr('settings.staff_TeamTab.v_deactivated', { v: staff.length - activeCount }) : ''}
          {visible.length !== staff.length ? tr('settings.staff_TeamTab.showing_length', { length: visible.length }) : ''}
        </Text>
      ) : null}

      <View style={{ flex: 1, minHeight: 280, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.surface }}>
        <DataList
          data={visible}
          keyExtractor={(m) => m.id}
          columns={columns}
          renderCard={renderCard}
          rowHeight={60}
          cardHeight={88}
          tableMinWidth={560}
          loading={loading}
          error={staffQ.error}
          onRetry={staffQ.reload}
          onRefresh={staffQ.reload}
          empty={q || filter !== 'all'
            ? { icon: 'search-outline', title: tr('settings.staff_TeamTab.no_one_matches'), message: tr('settings.staff_TeamTab.try_another_name_or_filter') }
            : { icon: 'people-outline', title: tr('settings.staff_TeamTab.no_staff_yet') }}
          onPressRow={openMember}
          keyboard
          extraData={busyId}
          rowActions={(m) => manageable(m)
            ? <Ionicons name="chevron-forward" size={18} color={colors.textSubtle} />
            : <Ionicons name="lock-closed-outline" size={16} color={colors.textSubtle} accessibilityLabel={tr('settings.staff_TeamTab.only_the_owner_can_change_this_login')} />}
          rowActionsWidth={36}
        />
      </View>
      {showTables && canAssignTables && staff.length > 1 && !isPhone ? (
        <Text variant="small" tone="subtle">{tr('settings.staff_TeamTab.tip_open_a_waiter_to_give_them_tables_new')}</Text>
      ) : null}

      {sheet?.mode === 'add' || sheet?.mode === 'edit' ? (
        <StaffSheet
          ctx={ctx}
          member={sheet.mode === 'edit' ? sheet.member : undefined}
          roles={roles}
          tables={canAssignTables ? tables : null}
          tableAssignSupported={assignSupported}
          staffNames={staffNames}
          onClose={() => setSheet(null)}
          onTablesChanged={tablesQ.silentReload}
          onSaved={(m, password, created) => {
            upsert(m);
            ctx.reloadRoles();
            setSheet(password && (created || m.is_active) ? { mode: 'share', email: m.email, password, name: m.full_name ?? m.email } : null);
          }}
        />
      ) : null}
      {sheet?.mode === 'share' ? <ShareLoginSheet {...sheet} onClose={() => setSheet(null)} /> : null}
    </View>
  );
}
