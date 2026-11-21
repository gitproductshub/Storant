/** Roles & permissions tab: role list with staff counts, permission matrix editor, custom roles, reset/delete. */
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { errorMessage } from '@/api/client';
import { teamApi, type PermissionGroup, type RoleDef } from '@/api/access';
import { Badge, Button, Card, EmptyState, ErrorState, Input, Loading, Sheet, Text, toast } from '@/components/ui';
import { useApi } from '@/hooks/useApi';
import { useNet } from '@/lib/sync';
import { useAccess } from '@/store/access';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { Callout, ChoiceChips } from '../components';
import { fieldErrorsFrom } from '../validation';
import { CheckRow, Row, TableHead, Toolbar, cellStyle, roleIcon, roleTone, type Column, type StaffCtx } from './shared';
import { brand } from '@/config/brand';
import { t } from '@/i18n';

/** Permissions that hand over control of the business; flagged when given to a custom role. */
const SENSITIVE = ['staff.manage', 'settings.manage', 'channels.manage', 'audit.view', 'orders.cancel'];

export function RolesTab({ ctx, refreshKey }: { ctx: StaffCtx; refreshKey: number }) {
  const { isPhone } = useLayout();
  const { colors } = useTheme();
  const online = useNet((s) => s.online && s.serverReachable);
  const catalogQ = useApi(() => teamApi.permissions(), [refreshKey]);
  const [sheet, setSheet] = useState<{ role: RoleDef | null } | null>(null);

  const customAllowed = ctx.hasFeature('custom_roles');
  const canCreate = ctx.isOwner && customAllowed;
  const totalPerms = useMemo(() => (catalogQ.data ?? []).reduce((n, g) => n + g.permissions.length, 0), [catalogQ.data]);
  const roles = ctx.roles;
  const customCount = (roles ?? []).filter((r) => !r.is_system).length;

  const columns: Column[] = [
    { key: 'role', label: t('common.role'), flex: 3 },
    { key: 'staff', label: t('common.staff'), width: 80, align: 'right' },
    { key: 'perms', label: t('settings.staff_RolesTab.permissions'), width: 120, align: 'right' },
    { key: 'go', label: '', width: 20 },
  ];

  const permsLabel = (r: RoleDef) => (r.key === 'owner' ? 'All' : totalPerms ? `${r.permissions.length} of ${totalPerms}` : String(r.permissions.length));

  return (
    <View style={{ gap: 16 }}>
      <Toolbar
        left={roles ? <Text variant="small" tone="muted">{roles.length} {t('settings.staff_RolesTab.roles')}{customCount ? t('settings.staff_RolesTab.customcount_custom', { customCount }) : ''}</Text> : null}
        right={canCreate ? <Button title={isPhone ? t('settings.staff_RolesTab.new_role') : t('settings.staff_RolesTab.create_role')} icon="add" onPress={() => setSheet({ role: null })} disabled={!online || !catalogQ.data} /> : null}
      />

      {!ctx.isOwner ? (
        <Callout tone="neutral" icon="shield-checkmark-outline">{t('settings.staff_RolesTab.only_the_owner_can_change_roles_you_can')}</Callout>
      ) : !customAllowed ? (
        <Callout tone="info" icon="sparkles-outline" title={t('settings.staff_RolesTab.custom_roles_aren_t_in_your_plan')}>
          {t('settings.staff_RolesTab.you_can_rename_the_built_in_roles_and', { brand: brand.name })}
        </Callout>
      ) : (
        <Callout tone="neutral" icon="bulb-outline">{t('settings.staff_RolesTab.changes_apply_to_everyone_with_that_role')}</Callout>
      )}

      {!roles && !ctx.rolesError ? <Loading label={t('settings.staff_RolesTab.loading_roles')} /> : null}
      {!roles && ctx.rolesError ? <ErrorState message={ctx.rolesError} onRetry={ctx.reloadRoles} /> : null}

      {roles ? (
        roles.length === 0 ? (
          <EmptyState icon="shield-outline" title={t('settings.staff_RolesTab.no_roles_yet')} message={t('settings.staff_RolesTab.pull_down_to_refresh')} />
        ) : (
          <Card padded={false} style={{ overflow: 'hidden' }}>
            {!isPhone ? <TableHead columns={columns} /> : null}
            {roles.map((r, i) => (
              <Row key={r.key} first={i === 0} onPress={() => setSheet({ role: r })} accessibilityLabel={t('settings.staff_RolesTab.name_staff_count_staff', { name: r.name, staff_count: r.staff_count })}
                style={isPhone ? { alignItems: 'flex-start' } : undefined}>
                <View style={[cellStyle(columns[0]!), { flexDirection: 'row', gap: 12, alignItems: 'flex-start' }]}>
                  <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name={roleIcon(r.key)} size={18} color={colors.textMuted} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      <Text variant="bodyStrong" numberOfLines={1}>{r.name}</Text>
                      <Badge label={r.is_system ? t('settings.staff_RolesTab.built_in') : t('common.custom')} tone={r.is_system ? 'neutral' : roleTone(r.key)} />
                    </View>
                    {r.description ? <Text variant="small" tone="muted" numberOfLines={2}>{r.description}</Text> : null}
                    {isPhone ? (
                      <Text variant="caption" tone="subtle">{r.staff_count} {t('settings.staff_RolesTab.staff_permslabel_permissions', { permsLabel: permsLabel(r) })}</Text>
                    ) : null}
                  </View>
                </View>
                {!isPhone ? (
                  <>
                    <View style={cellStyle(columns[1]!)}><Text variant="bodyStrong" tone={r.staff_count ? 'default' : 'subtle'}>{r.staff_count}</Text></View>
                    <View style={cellStyle(columns[2]!)}><Text variant="small" tone="muted">{permsLabel(r)}</Text></View>
                  </>
                ) : null}
                <View style={{ width: 20, alignItems: 'flex-end', alignSelf: 'center' }}>
                  <Ionicons name="chevron-forward" size={18} color={colors.textSubtle} />
                </View>
              </Row>
            ))}
          </Card>
        )
      ) : null}

      {sheet ? (
        <RoleSheet
          ctx={ctx}
          role={sheet.role}
          roles={roles ?? []}
          catalog={catalogQ.data}
          catalogError={catalogQ.error}
          onRetryCatalog={catalogQ.reload}
          onClose={() => setSheet(null)}
          onSaved={(saved) => {
            ctx.setRoles((list) => (list ? (list.some((x) => x.key === saved.key) ? list.map((x) => (x.key === saved.key ? saved : x)) : [...list, saved]) : [saved]));
            ctx.reloadRoles();
            void useAccess.getState().refresh();
            setSheet(null);
          }}
          onDeleted={(key) => {
            ctx.setRoles((list) => (list ? list.filter((x) => x.key !== key) : list));
            ctx.reloadRoles();
            setSheet(null);
          }}
        />
      ) : null}
    </View>
  );
}

function RoleSheet({ ctx, role, roles, catalog, catalogError, onRetryCatalog, onClose, onSaved, onDeleted }: {
  ctx: StaffCtx; role: RoleDef | null; roles: RoleDef[]; catalog: PermissionGroup[] | null; catalogError: string | null; onRetryCatalog: () => void;
  onClose: () => void; onSaved: (r: RoleDef) => void; onDeleted: (key: string) => void;
}) {
  const { isPhone, width } = useLayout();
  const online = useNet((s) => s.online && s.serverReachable);
  const creating = !role;
  const isOwnerRole = role?.key === 'owner';
  const canEdit = ctx.isOwner && (creating || !!role?.editable);
  const canEditPerms = canEdit && ctx.hasFeature('custom_roles');

  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [perms, setPerms] = useState<Set<string>>(new Set(role?.permissions ?? []));
  const [startFrom, setStartFrom] = useState<string>('blank');
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState<'delete' | 'reset' | null>(null);
  const [busy, setBusy] = useState(false);

  const initialPerms = useMemo(() => [...(role?.permissions ?? [])].sort().join(','), [role]);
  const dirty = creating
    ? true
    : name.trim() !== role!.name || (description.trim() || null) !== (role!.description || null) || [...perms].sort().join(',') !== initialPerms;

  const nameError = !name.trim() ? 'Give the role a name.' : name.trim().length < 2 ? 'Use at least 2 characters.' : name.trim().length > 40 ? 'Use 40 characters or fewer.' : undefined;
  const sensitive = !isOwnerRole && role?.key !== 'manager' ? SENSITIVE.filter((p) => perms.has(p)) : [];
  const describe = (code: string) => catalog?.flatMap((g) => g.permissions).find((p) => p.code === code)?.description ?? code;

  const toggle = (code: string) => setPerms((s) => { const n = new Set(s); if (n.has(code)) n.delete(code); else n.add(code); return n; });
  const setGroup = (g: PermissionGroup, on: boolean) => setPerms((s) => {
    const n = new Set(s);
    for (const p of g.permissions) if (p.available) { if (on) n.add(p.code); else n.delete(p.code); }
    return n;
  });

  const pickStart = (key: string) => {
    setStartFrom(key);
    const source = roles.find((r) => r.key === key);
    setPerms(new Set(source ? source.permissions : []));
  };

  const save = async () => {
    setSubmitted(true);
    setFormError(null);
    if (nameError) return;
    setSaving(true);
    try {
      let saved: RoleDef;
      if (creating) {
        saved = await teamApi.createRole({ name: name.trim(), description: description.trim() || null, permissions: [...perms] });
        toast.success(t('settings.staff_RolesTab.name_role_created', { name: saved.name }));
      } else {
        const body: { name?: string; description?: string | null; permissions?: string[] } = {};
        if (name.trim() !== role!.name) body.name = name.trim();
        if ((description.trim() || null) !== (role!.description || null)) body.description = description.trim();
        if (canEditPerms && [...perms].sort().join(',') !== initialPerms) body.permissions = [...perms];
        saved = await teamApi.updateRole(role!.key, body);
        toast.success(t('common.name_saved', { name: saved.name }));
      }
      onSaved(saved);
    } catch (e) {
      setFieldErrors(fieldErrorsFrom(e));
      setFormError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const doReset = async () => {
    if (!role) return;
    setBusy(true);
    try {
      const saved = await teamApi.resetRole(role.key);
      toast.success(t('settings.staff_RolesTab.name_is_back_to_brand_s_defaults', { name: saved.name, brand: brand.name }));
      onSaved(saved);
    } catch (e) {
      setFormError(errorMessage(e));
      setConfirming(null);
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    if (!role) return;
    setBusy(true);
    try {
      await teamApi.deleteRole(role.key);
      toast.success(t('settings.staff_RolesTab.name_role_deleted', { name: role.name }));
      onDeleted(role.key);
    } catch (e) {
      setFormError(errorMessage(e));
      setConfirming(null);
    } finally {
      setBusy(false);
    }
  };

  const twoCol = !isPhone && width >= 900;
  const title = creating ? t('settings.staff_RolesTab.create_role') : role!.name;
  const subtitle = creating ? t('settings.staff_RolesTab.pick_exactly_what_people_with_this_role') : isOwnerRole ? t('settings.staff_RolesTab.the_owner_always_has_full_access') : role!.is_system ? t('settings.staff_RolesTab.built_in_role') : t('settings.staff_RolesTab.custom_role');

  const footer = confirming ? (
    <Callout tone="danger" title={confirming === 'delete' ? t('settings.staff_RolesTab.delete_the_name_role', { name: role!.name }) : t('settings.staff_RolesTab.reset_name_to_brand_s_defaults', { name: role!.name, brand: brand.name })}
      action={<>
        <Button title={confirming === 'delete' ? t('settings.staff_RolesTab.delete_role') : t('settings.staff_RolesTab.reset_permissions')} variant="danger" size="sm" loading={busy}
          onPress={confirming === 'delete' ? doDelete : doReset} disabled={confirming === 'delete' && !!role!.staff_count} />
        <Button title={t('settings.staff_RolesTab.keep_it')} variant="secondary" size="sm" onPress={() => setConfirming(null)} disabled={busy} />
      </>}>
      {confirming === 'delete'
        ? role!.staff_count
          ? t('settings.staff_RolesTab.staff_count_staff_member_v_this_role_move', { staff_count: role!.staff_count, v: role!.staff_count === 1 ? t('settings.staff_RolesTab.still_has') : t('settings.staff_RolesTab.s_still_have') })
          : t('settings.staff_RolesTab.this_cannot_be_undone_past_bills_and_the')
        : t('settings.staff_RolesTab.your_changes_to_this_role_s_permissions')}
    </Callout>
  ) : (
    <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'space-between', flexWrap: 'wrap' }}>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {ctx.isOwner && role && !role.is_system && ctx.hasFeature('custom_roles') ? (
          <Button title={t('common.delete_2')} icon="trash-outline" variant="ghost" onPress={() => setConfirming('delete')} disabled={!online} />
        ) : null}
        {ctx.isOwner && role && role.is_system && role.editable ? (
          <Button title={isPhone ? t('common.reset') : t('settings.staff_RolesTab.reset_to_defaults')} icon="refresh" variant="ghost" onPress={() => setConfirming('reset')} disabled={!online} />
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', gap: 10, marginLeft: 'auto' }}>
        <Button title={canEdit ? t('common.cancel') : t('common.close')} variant="secondary" onPress={onClose} disabled={saving} />
        {canEdit ? <Button title={creating ? t('settings.staff_RolesTab.create_role') : t('common.save')} icon="checkmark" onPress={save} loading={saving} disabled={!dirty || !online || !catalog} /> : null}
      </View>
    </View>
  );

  return (
    <Sheet visible onClose={onClose} title={title} subtitle={subtitle} width={820} footer={footer} dismissable={!saving && !busy}>
      {formError ? <Callout tone="danger">{formError}</Callout> : null}

      {canEdit && !isOwnerRole ? (
        <View style={{ gap: 12 }}>
          <Input label={t('settings.staff_RolesTab.role_name')} required value={name} onChangeText={(v) => { setName(v); setFieldErrors((s) => ({ ...s, name: '' })); }} maxLength={40}
            error={fieldErrors.name || (submitted ? nameError : undefined)} placeholder={t('settings.staff_RolesTab.e_g_senior_captain')} autoFocus={creating} />
          <Input label={t('common.description')} value={description} onChangeText={setDescription} maxLength={200} placeholder={t('settings.staff_RolesTab.what_this_person_does_shown_when_adding')}
            error={fieldErrors.description} />
        </View>
      ) : role?.description ? (
        <Text tone="muted">{role.description}</Text>
      ) : null}

      {creating && roles.length > 0 ? (
        <View style={{ gap: 6 }}>
          <Text variant="smallStrong" tone="muted">{t('settings.staff_RolesTab.start_from')}</Text>
          <ChoiceChips value={startFrom} onChange={pickStart} accessibilityLabel={t('settings.staff_RolesTab.copy_permissions_from')}
            options={[{ value: 'blank', label: t('settings.staff_RolesTab.nothing') }, ...roles.filter((r) => r.key !== 'owner').map((r) => ({ value: r.key, label: r.name }))]} />
        </View>
      ) : null}

      {isOwnerRole ? (
        <Callout tone="info" icon="key-outline">{t('settings.staff_RolesTab.owners_can_do_everything_including_adding')}</Callout>
      ) : canEdit && !canEditPerms ? (
        <Callout tone="info" icon="sparkles-outline">{t('settings.staff_RolesTab.changing_permissions_needs_custom_roles', { brand: brand.name })}</Callout>
      ) : null}

      {sensitive.length && canEditPerms ? (
        <Callout tone="warning" title={t('settings.staff_RolesTab.this_role_gets_sensitive_access')}>
          {sensitive.map((p) => describe(p)).join(' · ')}
        </Callout>
      ) : null}

      {!catalog && catalogError ? <ErrorState message={catalogError} onRetry={onRetryCatalog} /> : null}
      {!catalog && !catalogError ? <Loading label={t('settings.staff_RolesTab.loading_permissions')} /> : null}

      {catalog ? (
        <View style={{ gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text variant="h3">{t('settings.staff_RolesTab.permissions')}</Text>
            <Text variant="small" tone="muted">
              {isOwnerRole ? t('common.all') : perms.size} {t('settings.staff_RolesTab.of')} {catalog.reduce((n, g) => n + g.permissions.length, 0)}
            </Text>
          </View>
          <View style={{ flexDirection: twoCol ? 'row' : 'column', flexWrap: twoCol ? 'wrap' : 'nowrap', gap: 12 }}>
            {catalog.map((g) => (
              <View key={g.group} style={twoCol ? { width: '48.8%' } : undefined}>
                <PermissionGroupCard group={g} checked={(code) => isOwnerRole || perms.has(code)} editable={canEditPerms && !isOwnerRole}
                  onToggle={toggle} onAll={(on) => setGroup(g, on)} />
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </Sheet>
  );
}

function PermissionGroupCard({ group, checked, editable, onToggle, onAll }: {
  group: PermissionGroup; checked: (code: string) => boolean; editable: boolean; onToggle: (code: string) => void; onAll: (on: boolean) => void;
}) {
  const available = group.permissions.filter((p) => p.available);
  const on = group.permissions.filter((p) => checked(p.code)).length;
  const allOn = available.length > 0 && available.every((p) => checked(p.code));
  const noneAvailable = available.length === 0;
  return (
    <Card padded={false} style={{ paddingVertical: 8, paddingHorizontal: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 4, minHeight: 36 }}>
        <Text variant="bodyStrong" style={{ flex: 1 }}>{group.group}</Text>
        {noneAvailable ? <Badge label={t('common.not_in_your_plan')} tone="neutral" icon="lock-closed-outline" /> : (
          <Text variant="caption" tone="subtle">{on}/{group.permissions.length}</Text>
        )}
        {editable && !noneAvailable ? (
          <Button title={allOn ? t('common.none') : t('common.all')} size="sm" variant="ghost" onPress={() => onAll(!allOn)} accessibilityLabel={t('settings.staff_RolesTab.v_all_group_permissions', { v: allOn ? t('common.clear') : t('settings.staff_RolesTab.select'), group: group.group })} />
        ) : null}
      </View>
      {group.permissions.map((p) => (
        <CheckRow key={p.code} checked={checked(p.code)} title={p.description} disabled={!editable || !p.available}
          onToggle={() => onToggle(p.code)}
          subtitle={!p.available ? t('common.not_in_your_plan') : undefined} />
      ))}
    </Card>
  );
}
