/**
 * Settings → QR table ordering. Owner/manager turn table ordering on or off, choose how guests pay
 * (counter / UPI / both), whether staff confirm each order before it reaches the kitchen (the QR channel's
 * auto-accept, inverted), and print the table QR codes.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Platform, View } from 'react-native';
import { router, type Href } from 'expo-router';
import { api, errorMessage, ApiError } from '@/api/client';
import { adminApi, tablesApi } from '@/api/endpoints';
import type { BusinessSettings, SalesChannel, TableInfo } from '@/api/types';
import { Button, Chip, EmptyState, ErrorState, Input, Loading, Text, toast } from '@/components/ui';
import { useApi } from '@/hooks/useApi';
import { can, useAuth } from '@/store/auth';
import { hasAccess, useAccessInfo } from '@/store/access';
import { useData } from '@/store/data';
import { useTheme } from '@/theme/ThemeProvider';
import { printTableQrs } from '@/features/ops/tableQr';
import { tableOrderUrl } from '@/features/ops/common';
import { SettingsFrame, confirmDiscard } from './SettingsFrame';
import { Callout, ChoiceChips, FormSection, Hairline, SaveBar, SettingSwitch, copyText, monoFont } from './components';
import { validateUpi } from './validation';
import { t as tr } from '@/i18n';

type PaymentMode = 'counter' | 'upi' | 'both';
type QrSettings = BusinessSettings & { qr_payment_mode?: PaymentMode | null };

interface Form { enabled: boolean; mode: PaymentMode; upiId: string; staffConfirm: boolean }

const MODE_OPTIONS: { value: PaymentMode; label: string }[] = [
  { value: 'counter', get label() { return tr('settings.QrOrderingScreen.at_the_counter'); } },
  { value: 'upi', get label() { return tr('settings.QrOrderingScreen.upi_only'); } },
  { value: 'both', get label() { return tr('settings.QrOrderingScreen.counter_or_upi'); } },
];

const MODE_HELP: Record<PaymentMode, string> = {
  counter: 'Guests pay the cashier or waiter (cash, card or UPI) when they’re done. Simple and familiar.',
  upi: 'Guests pay from their own UPI app right after ordering. Staff confirm each payment before the bill closes.',
  both: 'Guests choose: pay at the counter, or pay now by UPI from their phone.',
};

function formOf(s: QrSettings, qr: SalesChannel | undefined): Form {
  return {
    enabled: !!s.qr_ordering_enabled,
    mode: s.qr_payment_mode ?? 'both',
    upiId: s.upi_id ?? '',
    staffConfirm: qr ? !qr.auto_accept : true,
  };
}

export default function QrOrderingScreen() {
  const role = useAuth((s) => s.session?.role ?? null);
  const access = useAccessInfo();
  const allowed = hasAccess(access, { permissions: ['settings.manage'] }) ?? can(role, 'manage');
  if (!allowed) {
    return (
      <SettingsFrame active="qr" title={tr('common.qr_table_ordering')}>
        <EmptyState icon="lock-closed-outline" title={tr('settings.QrOrderingScreen.owners_and_managers_only')} message={tr('settings.QrOrderingScreen.ask_the_owner_or_a_manager_to_change_qr')} />
      </SettingsFrame>
    );
  }
  return <QrOrderingSettings />;
}

function QrOrderingSettings() {
  const { colors } = useTheme();
  const access = useAccessInfo();
  const role = useAuth((s) => s.session?.role ?? null);
  const tenantId = useAuth((s) => s.session?.tenantId ?? '');
  const inPlan = access ? access.features.includes('qr_ordering') : true; // unknown until /access/me loads: the server decides
  const { data, error, loading, reload, refreshing, setData } = useApi(async () => {
    const [settings, channels] = await Promise.all([api.get<QrSettings>('/settings'), adminApi.channels()]);
    return { settings, qr: channels.find((c) => c.code === 'QR') };
  }, []);
  const tables = useApi(() => tablesApi.list(), []);

  const initial = useMemo(() => (data ? formOf(data.settings, data.qr) : null), [data]);
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [upiTouched, setUpiTouched] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);

  // Follow fresh server data unless the user is in the middle of editing
  const lastInitial = useRef<string | null>(null);
  useEffect(() => {
    if (!initial) return;
    const previous = lastInitial.current;
    lastInitial.current = JSON.stringify(initial);
    setForm((f) => (!f || previous === null || JSON.stringify(f) === previous ? initial : f));
  }, [initial]);

  const activeTables = useMemo<TableInfo[]>(() => (tables.data ?? []).filter((t) => t.is_active !== false), [tables.data]);
  useEffect(() => {
    if (!previewId && activeTables.length) setPreviewId(activeTables[0].id);
  }, [activeTables, previewId]);

  if (loading && !data) {
    return <SettingsFrame active="qr" title={tr('common.qr_table_ordering')}><Loading label={tr('settings.QrOrderingScreen.loading_qr_ordering_settings')} /></SettingsFrame>;
  }
  if (!data || !form || !initial) {
    return (
      <SettingsFrame active="qr" title={tr('common.qr_table_ordering')}>
        <ErrorState message={error ?? tr('settings.QrOrderingScreen.couldn_t_load_the_settings')} onRetry={reload} />
      </SettingsFrame>
    );
  }

  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const needsUpi = form.mode !== 'counter';
  const upiFormatError = validateUpi(form.upiId);
  const upiError = upiFormatError ?? (needsUpi && !form.upiId.trim() ? 'Add your UPI ID so guests can pay by UPI.' : undefined);
  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setServerError(null);
    setForm((f) => (f ? { ...f, [key]: value } : f));
  };

  const save = async () => {
    if (upiError) {
      setUpiTouched(true);
      toast.error(upiError);
      return;
    }
    if (form.enabled && !initial.enabled && !inPlan) {
      toast.error(tr('settings.QrOrderingScreen.qr_table_ordering_isn_t_included_in_your'));
      return;
    }
    setSaving(true);
    setServerError(null);
    try {
      const body: Record<string, unknown> = { qr_ordering_enabled: form.enabled, qr_payment_mode: form.mode };
      if (form.upiId.trim() !== initial.upiId.trim()) body.upi_id = form.upiId.trim();
      const settings = await api.put<QrSettings>('/settings', body);
      let qr = data.qr;
      if (qr && form.staffConfirm !== initial.staffConfirm) {
        qr = await adminApi.updateChannel('QR', { auto_accept: !form.staffConfirm });
      }
      useData.getState().setSettings(settings);
      // Saving the settings also switches the QR channel on/off on the server: mirror that in the offline cache
      const savedQr = qr ? { ...qr, enabled: !!settings.qr_ordering_enabled } : undefined;
      if (savedQr) useData.setState((s) => ({ channels: s.channels.map((c) => (c.code === 'QR' ? { ...c, ...savedQr } : c)) }));
      setData({ settings, qr: savedQr });
      setForm(formOf(settings, savedQr));
      setUpiTouched(false);
      toast.success(settings.qr_ordering_enabled ? tr('settings.QrOrderingScreen.qr_table_ordering_is_on') : tr('settings.QrOrderingScreen.qr_table_ordering_saved'));
    } catch (e) {
      const message = e instanceof ApiError && (e.status === 403 || e.status === 422) ? e.message : errorMessage(e);
      setServerError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    setForm(initial);
    setUpiTouched(false);
    setServerError(null);
  };

  const print = async () => {
    if (!activeTables.length) return;
    setPrinting(true);
    try {
      await printTableQrs(activeTables, tenantId, data.settings.business_name || 'Scan to order');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setPrinting(false);
    }
  };

  const go = async (href: string) => {
    if (await confirmDiscard(dirty)) router.push(href as Href);
  };

  const preview = activeTables.find((t) => t.id === previewId) ?? null;
  const previewUrl = preview ? tableOrderUrl(tenantId, preview.id) : null;
  const openPreview = () => {
    if (!previewUrl) return;
    if (Platform.OS === 'web' && typeof window !== 'undefined') window.open(previewUrl, '_blank', 'noopener');
    else void Linking.openURL(previewUrl).catch(() => toast.error(tr('settings.QrOrderingScreen.couldn_t_open_the_link')));
  };

  const live = initial.enabled;

  return (
    <SettingsFrame active="qr" title={tr('common.qr_table_ordering')}
      subtitle={tr('settings.QrOrderingScreen.guests_scan_the_qr_code_on_their_table')}
      dirty={dirty} refreshing={refreshing} onRefresh={reload}
      footer={<SaveBar visible={dirty} saving={saving} onSave={save} onDiscard={discard} disabled={!!upiError && upiTouched} />}>

      {!inPlan ? (
        <Callout tone="warning" icon="lock-closed" title={tr('common.not_in_your_plan')}
          action={role === 'owner' ? <Button title={tr('settings.QrOrderingScreen.see_plans')} size="sm" variant="secondary" icon="card-outline" onPress={() => void go('/settings/billing')} /> : undefined}>
          {tr('settings.QrOrderingScreen.qr_table_ordering_isn_t_included_in_your_2')}
        </Callout>
      ) : live ? (
        <Callout tone="success" icon="checkmark-circle" title={tr('settings.QrOrderingScreen.guests_can_order_from_their_table')}>
          {initial.staffConfirm
            ? tr('settings.QrOrderingScreen.new_qr_orders_wait_in_online_orders_until')
            : tr('settings.QrOrderingScreen.new_qr_orders_go_straight_to_the_kitchen')}
        </Callout>
      ) : null}

      <FormSection title={tr('settings.QrOrderingScreen.table_ordering')} description={tr('settings.QrOrderingScreen.when_this_is_off_the_qr_code_still_shows')}>
        <SettingSwitch title={tr('settings.QrOrderingScreen.let_guests_order_from_their_table')} subtitle={form.enabled ? tr('settings.QrOrderingScreen.on_guests_can_order_by_scanning_the_table') : tr('settings.QrOrderingScreen.off_the_qr_shows_the_menu_only')}
          value={form.enabled} onValueChange={(v) => set('enabled', v)} disabled={!inPlan && !form.enabled} />
        <Hairline />
        <SettingSwitch title={tr('settings.QrOrderingScreen.staff_confirm_each_order_before_it_goes')}
          subtitle={form.staffConfirm
            ? tr('settings.QrOrderingScreen.recommended_a_cashier_or_waiter_accepts')
            : tr('settings.QrOrderingScreen.orders_go_straight_to_the_kitchen_and')}
          value={form.staffConfirm} onValueChange={(v) => set('staffConfirm', v)} disabled={!data.qr} />
        <Text variant="small" tone="subtle">
          {tr('settings.QrOrderingScreen.each_guest_gets_their_own_bill_on_the')}
        </Text>
      </FormSection>

      <FormSection title={tr('settings.QrOrderingScreen.how_guests_pay')} description={tr('settings.QrOrderingScreen.upi_payments_go_straight_to_your_own_upi')}>
        <ChoiceChips value={form.mode} options={MODE_OPTIONS} onChange={(v) => set('mode', v)} accessibilityLabel={tr('settings.QrOrderingScreen.how_guests_pay')} />
        <Text variant="small" tone="muted">{MODE_HELP[form.mode]}</Text>
        {needsUpi || form.upiId ? (
          <Input label={tr('settings.QrOrderingScreen.your_upi_id')} required={needsUpi} value={form.upiId} placeholder="yourshop@okaxis" icon="qr-code-outline"
            autoCapitalize="none" autoCorrect={false} keyboardType="email-address" maxLength={100}
            onChangeText={(v) => set('upiId', v.trim())} onBlur={() => setUpiTouched(true)}
            error={upiTouched || form.upiId ? upiError : undefined}
            hint={tr('settings.QrOrderingScreen.the_same_upi_id_is_printed_on_your_bills')} />
        ) : null}
        {needsUpi ? (
          <Callout tone="neutral" icon="shield-checkmark-outline">
            {tr('settings.QrOrderingScreen.after_paying_guests_tap_i_ve_paid_check')}
          </Callout>
        ) : null}
        {serverError ? <Callout tone="danger">{serverError}</Callout> : null}
      </FormSection>

      <FormSection title={tr('settings.QrOrderingScreen.qr_menu_prices')} description={tr('settings.QrOrderingScreen.what_guests_see_after_scanning')}>
        <Text variant="small" tone="muted">
          {tr('settings.QrOrderingScreen.the_qr_menu_shows_your_active_items_at')}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Button title={tr('settings.QrOrderingScreen.open_menu')} size="sm" variant="secondary" icon="restaurant-outline" onPress={() => void go('/menu')} />
          <Button title={tr('common.sales_channels')} size="sm" variant="secondary" icon="git-network-outline" onPress={() => void go('/settings/channels')} />
        </View>
      </FormSection>

      <FormSection title={tr('settings.QrOrderingScreen.table_qr_codes')} description={tr('settings.QrOrderingScreen.print_one_qr_card_per_table_and_stick_it')}>
        {tables.loading && !tables.data ? <Loading label={tr('settings.QrOrderingScreen.loading_tables')} /> : null}
        {tables.error && !tables.data ? <ErrorState message={tables.error} onRetry={tables.reload} /> : null}
        {tables.data && !activeTables.length ? (
          <EmptyState icon="grid-outline" title={tr('common.no_tables_yet')} message={tr('settings.QrOrderingScreen.add_your_tables_first_each_one_gets_its')}
            action={{ label: tr('common.add_tables'), icon: 'add', onPress: () => void go('/tables') }} />
        ) : null}
        {activeTables.length ? (
          <>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Button title={tr('settings.QrOrderingScreen.print_table_qr_codes_length', { length: activeTables.length })} icon="print-outline" onPress={print} loading={printing} />
              <Button title={tr('settings.QrOrderingScreen.manage_tables')} variant="secondary" icon="grid-outline" onPress={() => void go('/tables')} />
            </View>
            <Hairline />
            <View style={{ gap: 8 }}>
              <Text variant="smallStrong">{tr('settings.QrOrderingScreen.preview_the_guest_page')}</Text>
              <Text variant="small" tone="muted">{tr('settings.QrOrderingScreen.see_exactly_what_guests_see_when_they')}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {activeTables.slice(0, 24).map((t) => (
                  <Chip key={t.id} label={t.table_number} selected={t.id === previewId} onPress={() => setPreviewId(t.id)} />
                ))}
              </View>
              {previewUrl ? (
                <View style={{ gap: 8 }}>
                  <Text variant="small" tone="subtle" selectable numberOfLines={2} style={{ fontFamily: monoFont }}>{previewUrl}</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    <Button title={tr('settings.QrOrderingScreen.open_table_v', { v: preview?.table_number ?? '' })} size="sm" icon="open-outline" onPress={openPreview} />
                    <Button title={tr('settings.QrOrderingScreen.copy_link')} size="sm" variant="secondary" icon="copy-outline" onPress={() => void copyText(previewUrl, 'Link')} />
                  </View>
                  {!live ? (
                    <Text variant="small" color={colors.warningText}>{tr('settings.QrOrderingScreen.ordering_is_off_so_the_page_shows_the')}</Text>
                  ) : null}
                </View>
              ) : null}
            </View>
          </>
        ) : null}
      </FormSection>
    </SettingsFrame>
  );
}
