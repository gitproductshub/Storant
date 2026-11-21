/**
 * Staff & roles: Team (logins, roles, tables), Roles & permissions, Performance and Activity log.
 * Tabs are gated by permissions from /access/me (falls back to the built-in role rules until it loads).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { teamApi } from '@/api/access';
import { EmptyState } from '@/components/ui';
import { useApi } from '@/hooks/useApi';
import { useAuth } from '@/store/auth';
import { hasAccess, useAccess, useAccessInfo } from '@/store/access';
import { SettingsFrame } from './SettingsFrame';
import { Callout } from './components';
import { ActivityTab } from './staff/ActivityTab';
import { PerformanceTab } from './staff/PerformanceTab';
import { RolesTab } from './staff/RolesTab';
import { TeamTab } from './staff/TeamTab';
import { TabBar, type StaffCtx } from './staff/shared';
import { brand } from '@/config/brand';
import { t as tr } from '@/i18n';

type Tab = 'team' | 'roles' | 'performance' | 'activity';

/** Built-in defaults used only until /access/me has loaded (mirrors backend SYSTEM_ROLES). */
const FALLBACK: Record<string, string[]> = {
  owner: ['staff.view', 'staff.manage', 'reports.view', 'audit.view', 'tables.view', 'tables.manage'],
  manager: ['staff.view', 'staff.manage', 'reports.view', 'tables.view', 'tables.manage'],
};

export default function StaffScreen() {
  const session = useAuth((s) => s.session);
  const access = useAccessInfo();
  const myRole = access?.role ?? session?.role ?? null;
  const isOwner = myRole === 'owner';

  useEffect(() => { void useAccess.getState().refresh(); }, []);

  const can = (p: string) => (access ? access.permissions.includes(p) : (FALLBACK[myRole ?? ''] ?? []).includes(p));
  const hasFeature = (f: string) => (access ? access.features.includes(f) : true);
  const staffModule = hasAccess(access, { feature: 'staff' }) ?? true;

  const canViewStaff = staffModule && (can('staff.view') || can('staff.manage'));
  const canManageStaff = staffModule && can('staff.manage');
  const tabs = useMemo(() => {
    const list: { value: Tab; label: string; icon: 'people-outline' | 'shield-half-outline' | 'podium-outline' | 'time-outline' }[] = [];
    if (canViewStaff) list.push({ value: 'team', label: tr('settings.StaffScreen.team'), icon: 'people-outline' }, { value: 'roles', label: tr('settings.StaffScreen.roles_permissions'), icon: 'shield-half-outline' });
    if (canViewStaff && can('reports.view')) list.push({ value: 'performance', label: tr('settings.StaffScreen.performance'), icon: 'podium-outline' });
    if (can('audit.view')) list.push({ value: 'activity', label: tr('common.activity_log'), icon: 'time-outline' });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canViewStaff, access, myRole]);

  const [tab, setTab] = useState<Tab>('team');
  const current = tabs.find((t) => t.value === tab)?.value ?? tabs[0]?.value ?? null;
  const [refreshKey, setRefreshKey] = useState(0);

  const rolesQ = useApi(() => (canViewStaff ? teamApi.roles() : Promise.resolve([])), [canViewStaff, refreshKey]);

  const ctx: StaffCtx = {
    access,
    myRole,
    myStaffId: access?.staff_id ?? null,
    myEmail: (session?.email ?? '').toLowerCase(),
    isOwner,
    canManageStaff,
    hasFeature,
    can,
    roles: canViewStaff ? rolesQ.data : [],
    rolesError: rolesQ.error,
    reloadRoles: rolesQ.silentReload,
    setRoles: (update) => rolesQ.setData((list) => update(list)),
  };

  if (!current) {
    return (
      <SettingsFrame active="staff" title={tr('common.staff_roles')}>
        {!staffModule && access ? (
          <EmptyState icon="lock-closed-outline" title={tr('settings.StaffScreen.staff_accounts_aren_t_turned_on')}
            message={isOwner ? tr('settings.StaffScreen.turn_on_staff_accounts_in_settings', { brand: brand.name }) : tr('settings.StaffScreen.ask_the_owner_to_turn_on_staff_accounts')} />
        ) : (
          <EmptyState icon="lock-closed-outline" title={tr('common.managers_only')} message={tr('settings.StaffScreen.ask_the_owner_or_a_manager_to_add_or')} />
        )}
      </SettingsFrame>
    );
  }

  return (
    <SettingsFrame
      active="staff"
      title={tr('common.staff_roles')}
      subtitle={tr('settings.StaffScreen.give_each_person_their_own_login_with')}
      onRefresh={() => { setRefreshKey((k) => k + 1); void useAccess.getState().refresh(); }}
      refreshing={false}
      maxWidth={1120}
      scroll={current !== 'team'}
    >
      <View style={[{ gap: 16 }, current === 'team' && { flex: 1, minHeight: 0 }]}>
        {tabs.length > 1 ? <TabBar value={current} options={tabs} onChange={setTab} /> : null}
        {!staffModule && current === 'activity' ? (
          <Callout tone="neutral">{tr('settings.StaffScreen.staff_accounts_are_turned_off_for_this')}</Callout>
        ) : null}
        {current === 'team' ? <TeamTab ctx={ctx} refreshKey={refreshKey} /> : null}
        {current === 'roles' ? <RolesTab ctx={ctx} refreshKey={refreshKey} /> : null}
        {current === 'performance' ? <PerformanceTab ctx={ctx} refreshKey={refreshKey} /> : null}
        {current === 'activity' ? <ActivityTab ctx={ctx} refreshKey={refreshKey} /> : null}
      </View>
    </SettingsFrame>
  );
}
