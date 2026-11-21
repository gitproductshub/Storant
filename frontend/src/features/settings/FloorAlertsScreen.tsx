/**
 * Settings → Floor alerts. When a table, a kitchen ticket or a waiting online order turns amber and red on the
 * floor screens (Tables, Kitchen, Online orders). Saved as the business setting `ops_thresholds`.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, errorMessage } from '@/api/client';
import type { BusinessSettings } from '@/api/types';
import { Button, EmptyState, ErrorState, Input, Loading, Text, toast } from '@/components/ui';
import { useApi } from '@/hooks/useApi';
import { can, useAuth } from '@/store/auth';
import { hasAccess, useAccessInfo } from '@/store/access';
import { useData } from '@/store/data';
import { SettingsFrame } from './SettingsFrame';
import { Callout, FieldRow, FormSection, SaveBar } from './components';
import { OPS_DEFAULTS, opsFormOf, opsValues, validateOps, type OpsForm, type OpsKey } from './floorAlerts';
import { t } from '@/i18n';

export default function FloorAlertsScreen() {
  const role = useAuth((s) => s.session?.role ?? null);
  const access = useAccessInfo();
  const allowed = hasAccess(access, { permissions: ['settings.manage'] }) ?? can(role, 'manage');
  if (!allowed) {
    return (
      <SettingsFrame active="floor" title={t('common.floor_alerts')}>
        <EmptyState icon="lock-closed-outline" title={t('settings.FloorAlertsScreen.owners_and_managers_only')} message={t('settings.FloorAlertsScreen.ask_the_owner_or_a_manager_to_change_the')} />
      </SettingsFrame>
    );
  }
  return <FloorAlertsSettings />;
}

function FloorAlertsSettings() {
  const { data, error, loading, reload, refreshing, setData } = useApi(() => api.get<BusinessSettings>('/settings'), []);
  const initial = useMemo(() => (data ? opsFormOf(data.ops_thresholds) : null), [data]);
  const [form, setForm] = useState<OpsForm | null>(null);
  const [saving, setSaving] = useState(false);

  // Follow fresh server data unless the user is in the middle of editing
  const lastInitial = useRef<string | null>(null);
  useEffect(() => {
    if (!initial) return;
    const previous = lastInitial.current;
    lastInitial.current = JSON.stringify(initial);
    setForm((f) => (!f || previous === null || JSON.stringify(f) === previous ? initial : f));
  }, [initial]);

  if (loading && !data) return <SettingsFrame active="floor" title={t('common.floor_alerts')}><Loading label={t('settings.FloorAlertsScreen.loading_floor_alerts')} /></SettingsFrame>;
  if (!data || !form || !initial) {
    return <SettingsFrame active="floor" title={t('common.floor_alerts')}><ErrorState message={error ?? t('settings.FloorAlertsScreen.couldn_t_load_the_settings')} onRetry={reload} /></SettingsFrame>;
  }

  const errors = validateOps(form);
  const invalid = Object.keys(errors).length > 0;
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const isDefault = JSON.stringify(form) === JSON.stringify(opsFormOf(OPS_DEFAULTS));
  const set = (k: OpsKey) => (v: string) => setForm((f) => (f ? { ...f, [k]: v.replace(/[^0-9]/g, '') } : f));

  const save = async () => {
    if (invalid) {
      toast.error(Object.values(errors)[0] ?? t('settings.FloorAlertsScreen.check_the_times'));
      return;
    }
    setSaving(true);
    try {
      const settings = await api.put<BusinessSettings>('/settings', { ops_thresholds: opsValues(form) });
      useData.getState().setSettings(settings); // the floor screens read the times from here
      setData(settings);
      setForm(opsFormOf(settings.ops_thresholds));
      toast.success(t('settings.FloorAlertsScreen.floor_alerts_saved'));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const field = (k: OpsKey, label: string, hint?: string) => (
    <Input label={label} value={form[k]} onChangeText={set(k)} keyboardType="number-pad" maxLength={3} error={errors[k]} hint={hint}
      right={<Text variant="small" tone="subtle">{t('settings.FloorAlertsScreen.min')}</Text>} />
  );

  return (
    <SettingsFrame active="floor" title={t('common.floor_alerts')}
      subtitle={t('settings.FloorAlertsScreen.when_tables_kitchen_tickets_and_online')}
      dirty={dirty} refreshing={refreshing} onRefresh={reload}
      actions={!isDefault ? <Button title={t('settings.FloorAlertsScreen.use_defaults')} size="sm" variant="ghost" icon="refresh-outline" onPress={() => setForm(opsFormOf(OPS_DEFAULTS))} /> : undefined}
      footer={<SaveBar visible={dirty} saving={saving} onSave={save} onDiscard={() => setForm(initial)} disabled={invalid} />}>
      <FormSection title={t('common.tables')} description={t('settings.FloorAlertsScreen.time_since_the_first_bill_on_the_table')}>
        <FieldRow>
          {field('table_amber_min', 'Amber after', `Default ${OPS_DEFAULTS.table_amber_min}`)}
          {field('table_red_min', 'Red after', `Default ${OPS_DEFAULTS.table_red_min}`)}
        </FieldRow>
      </FormSection>
      <FormSection title={t('common.kitchen')} description={t('settings.FloorAlertsScreen.time_since_the_kot_reached_the_kitchen')}>
        <FieldRow>
          {field('kitchen_amber_min', 'Amber after', `Default ${OPS_DEFAULTS.kitchen_amber_min}`)}
          {field('kitchen_red_min', 'Red after', `Default ${OPS_DEFAULTS.kitchen_red_min}`)}
        </FieldRow>
      </FormSection>
      <FormSection title={t('common.online_orders')} description={t('settings.FloorAlertsScreen.time_a_new_swiggy_zomato_qr_or_store')}>
        {field('online_wait_min', 'Amber after', `Turns red at twice this time. Default ${OPS_DEFAULTS.online_wait_min}`)}
      </FormSection>
      <Callout tone="neutral" icon="phone-portrait-outline">
        {t('settings.FloorAlertsScreen.this_device_uses_the_new_times_straight')}
      </Callout>
    </SettingsFrame>
  );
}
