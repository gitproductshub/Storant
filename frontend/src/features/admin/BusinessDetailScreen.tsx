/**
 * One business: owner contact, status (suspend / reactivate), access (demo / development / locked), signed-in devices,
 * plan + per-feature overrides + limits, admin notes, owner password reset, payment history and "Record payment".
 */
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { errorMessage } from '@/api/client';
import {
  LIMIT_KEYS, platformApi,
  type AuditEntry, type BusinessDetail, type BusinessUpdateBody, type LimitKey, type Limits, type PlanInfo,
} from '@/api/platform';
import { Badge, Button, Card, Divider, EmptyState, ErrorState, Input, Loading, Segmented, Sheet, Text, confirm, toast } from '@/components/ui';
import { useApi } from '@/hooks/useApi';
import { ago, formatDateTime } from '@/lib/format';
import { useLayout } from '@/theme/ThemeProvider';
import { Callout, ChoiceChips, KeyValue, SaveBar, copyText } from '@/features/settings/components';
import { AccessCard, DevicesCard, PaymentsCard, RecordPaymentSheet } from './BusinessAccess';
import { RecordsCard } from './BusinessRecords';
import { CredentialsSheet } from './OnboardBusinessSheet';
import { featureGroupHeading } from './featureGroups';
import {
  AccessBadge, AdminPage, BUSINESS_TYPE_LABEL, LIMIT_LABEL, PlanBadge, ReadOnlyNote, StatusBadge,
  accessDaysText, actionLabel, limitText, shortDate, useCanEdit, useOnline,
} from './shared';
import { brand } from '@/config/brand';
import { t, currentLocale } from '@/i18n';

type FeatureMode = 'default' | 'on' | 'off';
type LimitMode = 'plan' | 'custom' | 'unlimited';
interface LimitDraft { mode: LimitMode; value: string }
interface Draft {
  planKey: string;
  features: Record<string, boolean>;
  limits: Record<LimitKey, LimitDraft>;
  notes: string;
}

function draftFrom(b: BusinessDetail): Draft {
  const limits = {} as Record<LimitKey, LimitDraft>;
  for (const key of LIMIT_KEYS) {
    const has = Object.prototype.hasOwnProperty.call(b.limit_overrides ?? {}, key);
    const v = b.limit_overrides?.[key];
    limits[key] = !has ? { mode: 'plan', value: '' } : v === null || v === undefined ? { mode: 'unlimited', value: '' } : { mode: 'custom', value: String(v) };
  }
  return { planKey: b.plan_key, features: { ...(b.feature_overrides ?? {}) }, limits, notes: b.admin_notes ?? '' };
}

function sameDraft(a: Draft, b: Draft): boolean {
  return JSON.stringify(normalise(a)) === JSON.stringify(normalise(b));
}

function normalise(d: Draft) {
  return {
    planKey: d.planKey,
    features: Object.keys(d.features).sort().map((k) => [k, d.features[k]]),
    limits: LIMIT_KEYS.map((k) => [k, d.limits[k].mode, d.limits[k].mode === 'custom' ? d.limits[k].value.trim() : '']),
    notes: d.notes.trim(),
  };
}

function limitError(l: LimitDraft): string | undefined {
  if (l.mode !== 'custom') return undefined;
  const v = l.value.trim();
  if (!/^\d+$/.test(v)) return 'Enter a whole number.';
  if (Number(v) > 1_000_000) return 'Too large.';
  return undefined;
}

export default function BusinessDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <BusinessDetailView businessId={String(id ?? '')} />;
}

/**
 * The business page. As a desktop side panel (`onClose` set) it stacks in one column next to the businesses list,
 * and the list stays visible.
 */
export function BusinessDetailView({ businessId, onClose, onChanged }: { businessId: string; onClose?: () => void; onChanged?: () => void }) {
  const panel = !!onClose;
  const { width } = useLayout();
  const canEditRole = useCanEdit();
  const online = useOnline();
  const detail = useApi(() => platformApi.business(businessId), [businessId]);
  const plans = useApi(() => platformApi.plans(), []);
  const activity = useApi(() => platformApi.audit({ business_id: businessId, limit: 20 }), [businessId]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [sheet, setSheet] = useState<null | 'suspend' | 'payment' | { email: string; password: string }>(null);
  const [busy, setBusy] = useState<null | 'reactivate' | 'reset'>(null);

  const b = detail.data;
  const baseline = useMemo(() => (b ? draftFrom(b) : null), [b]);
  const form = draft ?? baseline;
  const dirty = !!(draft && baseline && !sameDraft(draft, baseline));
  const closed = b?.status === 'deleted';
  const editable = canEditRole && !closed;
  const twoCol = !panel && width >= 1240;

  const edit = (patch: Partial<Draft>) => {
    if (!form) return;
    setDraft({ ...form, ...patch });
  };

  const goBack = async () => {
    if (dirty && !(await confirm({ title: t('common.discard_unsaved_changes'), message: t('admin.BusinessDetailScreen.you_changed_this_business_but_did_not_save'), confirmLabel: t('common.discard'), danger: true }))) return;
    if (onClose) { onClose(); return; }
    if (router.canGoBack()) router.back();
    else router.replace('/admin/businesses' as Href);
  };

  const reloadAll = () => {
    void detail.reload();
    void plans.reload();
    void activity.reload();
  };

  const applyDetail = (next: BusinessDetail) => {
    detail.setData(next);
    onChanged?.();
    void activity.silentReload();
  };

  const limitErrors = form ? LIMIT_KEYS.map((k) => limitError(form.limits[k])).filter(Boolean) : [];

  const save = async () => {
    if (!b || !form || !baseline) return;
    if (limitErrors.length) {
      toast.error(t('admin.BusinessDetailScreen.fix_the_limits_before_saving'));
      return;
    }
    const body: BusinessUpdateBody = {};
    if (form.planKey !== baseline.planKey) body.plan_key = form.planKey;
    if (JSON.stringify(normalise(form).features) !== JSON.stringify(normalise(baseline).features)) body.feature_overrides = form.features;
    if (JSON.stringify(normalise(form).limits) !== JSON.stringify(normalise(baseline).limits)) {
      const limits: Limits = {};
      for (const k of LIMIT_KEYS) {
        const l = form.limits[k];
        if (l.mode === 'unlimited') limits[k] = null;
        else if (l.mode === 'custom') limits[k] = Number(l.value.trim());
      }
      body.limit_overrides = limits;
    }
    if (form.notes.trim() !== baseline.notes.trim()) body.admin_notes = form.notes.trim() || null;
    setSaving(true);
    try {
      const next = await platformApi.updateBusiness(b.id, body);
      applyDetail(next);
      setDraft(null);
      toast.success(t('admin.BusinessDetailScreen.business_updated'));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const reactivate = async () => {
    if (!b) return;
    const ok = await confirm({ title: t('admin.BusinessDetailScreen.reactivate_name', { name: b.name }), message: t('admin.BusinessDetailScreen.the_owner_and_staff_can_sign_in_and_bill'), confirmLabel: t('admin.BusinessDetailScreen.reactivate') });
    if (!ok) return;
    setBusy('reactivate');
    try {
      applyDetail(await platformApi.updateBusiness(b.id, { status: 'active', status_reason: null }));
      toast.success(t('admin.BusinessDetailScreen.name_is_active_again', { name: b.name }));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const resetPassword = async () => {
    if (!b) return;
    const ok = await confirm({
      title: t('admin.BusinessDetailScreen.reset_the_owner_password'),
      message: t('admin.BusinessDetailScreen.v_gets_a_new_temporary_password_the_old', { v: b.owner.email ?? t('admin.BusinessDetailScreen.the_owner') }),
      confirmLabel: t('admin.BusinessDetailScreen.reset_password'), danger: true,
    });
    if (!ok) return;
    setBusy('reset');
    try {
      const r = await platformApi.resetOwnerPassword(b.id);
      setSheet({ email: r.owner_email, password: r.temporary_password });
      void activity.silentReload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  if (!b || !form) {
    return (
      <AdminPage title={t('common.business')} back={{ label: panel ? t('common.close') : t('admin.BusinessDetailScreen.all_businesses'), onPress: goBack }}>
        {detail.loading ? <Loading label={t('admin.BusinessDetailScreen.loading_business')} /> : null}
        {detail.error && !detail.loading ? <ErrorState message={detail.error} onRetry={detail.reload} /> : null}
      </AdminPage>
    );
  }

  const planList = plans.data?.plans ?? [];
  const selectedPlan = planList.find((p) => p.key === form.planKey) ?? null;
  const currentPlanName = planList.find((p) => p.key === b.plan_key)?.name ?? b.plan_key;

  const statusCard = <StatusCard business={b} editable={editable} online={online} busy={busy === 'reactivate'} onSuspend={() => setSheet('suspend')} onReactivate={reactivate} />;
  const ownerCard = <OwnerCard business={b} editable={editable} online={online} resetting={busy === 'reset'} onReset={resetPassword} />;
  const paymentsCard = <PaymentsCard business={b} planName={currentPlanName} editable={editable} online={online} onRecord={() => setSheet('payment')} />;
  const accessCard = (
    <AccessCard business={b} editable={editable} online={online} onRecordPayment={() => setSheet('payment')}
      onChanged={(next) => { if (next) applyDetail(next); else { void detail.silentReload(); void activity.silentReload(); } }} />
  );
  const devicesCard = <DevicesCard business={b} editable={canEditRole && !closed} />;
  // Records stay correctable after the owner closes the business (the owner may ask Storant to remove data)
  const recordsCard = <RecordsCard businessId={b.id} businessName={b.name} editable={canEditRole} />;
  const planCard = (
    <PlanFeaturesCard business={b} form={form} plans={planList} plansError={plans.error} selectedPlan={selectedPlan} editable={editable}
      onPlan={(planKey) => edit({ planKey })}
      onFeature={(key, mode) => {
        const features = { ...form.features };
        if (mode === 'default') delete features[key];
        else features[key] = mode === 'on';
        edit({ features });
      }} />
  );
  const limitsCard = (
    <LimitsCard business={b} form={form} selectedPlan={selectedPlan} editable={editable}
      onLimit={(key, l) => edit({ limits: { ...form.limits, [key]: l } })} />
  );
  const notesCard = (
    <Card style={{ gap: 10 }}>
      <View>
        <Text variant="h3">{t('admin.BusinessDetailScreen.admin_notes')}</Text>
        <Text variant="small" tone="muted">{t('admin.BusinessDetailScreen.only_brand_staff_see_these_deal_terms', { brand: brand.name })}</Text>
      </View>
      <Input value={form.notes} onChangeText={(notes) => edit({ notes })} multiline maxLength={2000} editable={editable}
        placeholder={editable ? t('admin.BusinessDetailScreen.e_g_paid_yearly_by_bank_transfer_call') : t('admin.BusinessDetailScreen.no_notes')}
        style={{ minHeight: 96, textAlignVertical: 'top', paddingTop: 10 }} accessibilityLabel={t('admin.BusinessDetailScreen.admin_notes')} />
      <Text variant="caption" tone="subtle" style={{ alignSelf: 'flex-end' }}>{form.notes.length}/2000</Text>
    </Card>
  );
  const staffCard = <StaffCard business={b} />;
  const activityCard = <ActivityCard entries={activity.data} loading={activity.loading} error={activity.error} onRetry={activity.reload} />;

  return (
    <AdminPage
      title={b.name}
      subtitle={t('admin.BusinessDetailScreen.v_joined_shortdate_v2', { v: BUSINESS_TYPE_LABEL[b.business_type] ?? b.business_type, shortDate: shortDate(b.created_at), v2: b.last_activity_at ? t('admin.BusinessDetailScreen.last_bill_ago_ago', { ago: ago(b.last_activity_at) }) : t('admin.BusinessDetailScreen.no_bills_yet') })}
      back={{ label: panel ? t('common.close') : t('admin.BusinessDetailScreen.all_businesses'), onPress: goBack }}
      refreshing={detail.refreshing}
      onRefresh={reloadAll}
      maxWidth={1320}
      actions={panel ? <Button title={t('admin.BusinessDetailScreen.full_page')} icon="open-outline" variant="outline" size="sm" onPress={() => router.push(`/admin/businesses/${b.id}` as Href)} /> : undefined}
      toolbar={
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <StatusBadge status={b.status} />
          <PlanBadge name={currentPlanName} />
          <AccessBadge access={b.access} />
          {b.access?.paid_until ? (
            <Text variant="small" tone="muted">
              {b.access.state === 'development' ? t('admin.BusinessDetailScreen.no_expiry')
                : b.access.state === 'lapsed' || b.access.state === 'grace' ? t('admin.BusinessDetailScreen.ended_shortdate', { shortDate: shortDate(b.access.paid_until) })
                  : t('admin.BusinessDetailScreen.accessdaystext_until_shortdate', { accessDaysText: accessDaysText(b.access), shortDate: shortDate(b.access.paid_until) })}
            </Text>
          ) : null}
        </View>
      }
      footer={editable ? (
        <SaveBar visible={dirty} saving={saving} onSave={save} onDiscard={() => setDraft(null)} disabled={!online || limitErrors.length > 0}
          message={online ? t('admin.BusinessDetailScreen.unsaved_changes_to_plan_features_limits') : t('admin.BusinessDetailScreen.you_re_offline_changes_can_t_be_saved_yet')} />
      ) : null}
    >
      {!canEditRole ? <ReadOnlyNote what="change businesses" /> : null}
      {twoCol ? (
        <View style={{ flexDirection: 'row', gap: 20, alignItems: 'flex-start' }}>
          <View style={{ flex: 1.55, minWidth: 0, gap: 20 }}>
            {planCard}
            {limitsCard}
            {notesCard}
            {staffCard}
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 20 }}>
            {statusCard}
            {accessCard}
            {paymentsCard}
            {devicesCard}
            {ownerCard}
            {activityCard}
          </View>
        </View>
      ) : null}
      {twoCol ? recordsCard : (
        <View style={{ gap: 20 }}>
          {statusCard}
          {accessCard}
          {paymentsCard}
          {devicesCard}
          {ownerCard}
          {planCard}
          {limitsCard}
          {notesCard}
          {staffCard}
          {recordsCard}
          {activityCard}
        </View>
      )}

      {sheet === 'suspend' ? (
        <SuspendSheet business={b} onClose={() => setSheet(null)} onDone={(next) => { applyDetail(next); setSheet(null); }} />
      ) : null}
      {sheet === 'payment' ? (
        <RecordPaymentSheet business={b} plans={planList} onClose={() => setSheet(null)}
          onDone={() => { setSheet(null); setDraft(null); void detail.silentReload(); void activity.silentReload(); }} />
      ) : null}
      {sheet && typeof sheet === 'object' ? (
        <CredentialsSheet title={t('admin.BusinessDetailScreen.owner_password_reset')} heading={t('admin.BusinessDetailScreen.new_temporary_password')} email={sheet.email} password={sheet.password}
          message={t('admin.BusinessDetailScreen.the_old_password_no_longer_works_send')} onClose={() => setSheet(null)} />
      ) : null}
    </AdminPage>
  );
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

function CardTitle({ title, subtitle, right }: { title: string; subtitle?: string; right?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="h3" accessibilityRole="header">{title}</Text>
        {subtitle ? <Text variant="small" tone="muted">{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

function StatusCard({ business: b, editable, online, busy, onSuspend, onReactivate }: {
  business: BusinessDetail; editable: boolean; online: boolean; busy: boolean; onSuspend: () => void; onReactivate: () => void;
}) {
  if (b.status === 'deleted') {
    return (
      <Callout tone="neutral" icon="archive-outline" title={t('admin.BusinessDetailScreen.closed_by_the_owner')}>
        {t('admin.BusinessDetailScreen.the_owner_deleted_this_business_account')}
      </Callout>
    );
  }
  if (b.status === 'suspended') {
    return (
      <Callout tone="danger" icon="pause-circle" title={t('common.suspended')}
        action={editable ? <Button title={t('admin.BusinessDetailScreen.reactivate')} icon="play-circle-outline" variant="success" size="sm" onPress={onReactivate} loading={busy} disabled={!online} /> : undefined}>
        <Text variant="small">{b.status_reason ? t('admin.BusinessDetailScreen.reason_status_reason', { status_reason: b.status_reason }) : ''}{t('admin.BusinessDetailScreen.the_owner_and_staff_can_t_sign_in_or_bill')}</Text>
      </Callout>
    );
  }
  return (
    <Card style={{ gap: 10 }}>
      <CardTitle title={t('admin.BusinessDetailScreen.account_status')} subtitle={t('admin.BusinessDetailScreen.active_the_owner_and_staff_can_sign_in')}
        right={<StatusBadge status={b.status} />} />
      {editable ? (
        <Button title={t('admin.BusinessDetailScreen.suspend_business')} icon="pause-circle-outline" variant="secondary" onPress={onSuspend} disabled={!online} style={{ alignSelf: 'flex-start' }} />
      ) : null}
    </Card>
  );
}

function OwnerCard({ business: b, editable, online, resetting, onReset }: {
  business: BusinessDetail; editable: boolean; online: boolean; resetting: boolean; onReset: () => void;
}) {
  const s = b.settings;
  return (
    <Card style={{ gap: 6 }}>
      <CardTitle title={t('admin.BusinessDetailScreen.owner_contact')} />
      <KeyValue label={t('common.owner')} value={b.owner.name ?? '—'} />
      <KeyValue label={t('common.email')} value={b.owner.email ?? '—'}
        right={b.owner.email ? <Button icon="copy-outline" size="sm" variant="ghost" accessibilityLabel={t('admin.BusinessDetailScreen.copy_owner_email')} onPress={() => copyText(b.owner.email!, 'Email')} /> : undefined} />
      <KeyValue label={t('common.phone')} value={b.owner.phone ?? s?.phone ?? '—'}
        right={(b.owner.phone ?? s?.phone) ? <Button icon="copy-outline" size="sm" variant="ghost" accessibilityLabel={t('admin.BusinessDetailScreen.copy_owner_phone')} onPress={() => copyText((b.owner.phone ?? s?.phone)!, 'Phone')} /> : undefined} />
      {s?.email && s.email !== b.owner.email ? <KeyValue label={t('admin.BusinessDetailScreen.business_email')} value={s.email} /> : null}
      {s?.address ? <KeyValue label={t('admin.BusinessDetailScreen.address')} value={s.address} /> : null}
      <KeyValue label={t('admin.BusinessDetailScreen.gstin')} value={s?.gstin || (s?.gst_registration === 'unregistered' ? 'Not registered' : '—')} mono={!!s?.gstin} />
      <KeyValue label={t('admin.BusinessDetailScreen.business_id')} value={b.id} mono
        right={<Button icon="copy-outline" size="sm" variant="ghost" accessibilityLabel={t('admin.BusinessDetailScreen.copy_business_id')} onPress={() => copyText(b.id, 'Business ID')} />} />
      {editable ? (
        <>
          <Divider style={{ marginVertical: 6 }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <Text variant="small" tone="muted" style={{ flex: 1, minWidth: 180 }}>{t('admin.BusinessDetailScreen.locked_out_give_the_owner_a_new_temporary')}</Text>
            <Button title={t('admin.BusinessDetailScreen.reset_owner_password')} icon="key-outline" variant="secondary" size="sm" onPress={onReset} loading={resetting} disabled={!online || !b.owner.email} />
          </View>
        </>
      ) : null}
    </Card>
  );
}

function featureMode(features: Record<string, boolean>, key: string): FeatureMode {
  if (!(key in features)) return 'default';
  return features[key] ? 'on' : 'off';
}

const FEATURE_MODES: { value: FeatureMode; label: string }[] = [
  { value: 'default', get label() { return t('admin.BusinessDetailScreen.plan_default'); } }, { value: 'on', get label() { return t('admin.BusinessDetailScreen.force_on'); } }, { value: 'off', get label() { return t('admin.BusinessDetailScreen.force_off'); } },
];

function PlanFeaturesCard({ business: b, form, plans, plansError, selectedPlan, editable, onPlan, onFeature }: {
  business: BusinessDetail; form: Draft; plans: PlanInfo[]; plansError: string | null; selectedPlan: PlanInfo | null; editable: boolean;
  onPlan: (key: string) => void; onFeature: (key: string, mode: FeatureMode) => void;
}) {
  const { isPhone } = useLayout();
  const planFeatures = new Set(selectedPlan?.features ?? []);
  const hidden = new Set(b.hidden_by_owner);
  const overrides = Object.keys(form.features).length;
  const planOptions = plans.filter((p) => p.is_active || p.key === b.plan_key || p.key === form.planKey);
  return (
    <Card style={{ gap: 14 }}>
      <CardTitle title={t('admin.BusinessDetailScreen.plan_features')}
        subtitle={t('admin.BusinessDetailScreen.features_come_from_the_plan_override')} />
      <View style={{ gap: 6 }}>
        <Text variant="smallStrong" tone="muted">{t('common.plan')}</Text>
        {plans.length ? (
          editable ? (
            <ChoiceChips value={form.planKey} onChange={onPlan} accessibilityLabel={t('common.plan')}
              options={planOptions.map((p) => ({ value: p.key, label: p.price_monthly ? t('admin.BusinessDetailScreen.name_tolocalestring_mo', { name: p.name, toLocaleString: p.price_monthly.toLocaleString(currentLocale()) }) : p.name }))} />
          ) : <PlanBadge name={selectedPlan?.name ?? form.planKey} />
        ) : plansError ? <Text variant="small" tone="danger">{t('admin.BusinessDetailScreen.couldn_t_load_plans')} {plansError}</Text> : <Text variant="small" tone="subtle">{t('admin.BusinessDetailScreen.loading_plans')}</Text>}
        {form.planKey !== b.plan_key ? (
          <Text variant="small" tone="warning">{t('admin.BusinessDetailScreen.plan_changes_when_you_save_recording_a')}</Text>
        ) : null}
      </View>

      <Divider />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Text variant="smallStrong" tone="muted" style={{ flex: 1 }}>{t('admin.BusinessDetailScreen.features')}</Text>
        {overrides ? <Badge label={t('admin.BusinessDetailScreen.overrides_override_v', { overrides, v: overrides === 1 ? '' : 's' })} tone="accent" /> : <Badge label={t('admin.BusinessDetailScreen.all_from_plan')} tone="neutral" />}
      </View>
      <View>
        {b.features_catalog.map((f, i) => {
          const mode = featureMode(form.features, f.key);
          const inPlan = planFeatures.has(f.key);
          const enabled = mode === 'default' ? inPlan : mode === 'on';
          const status = (
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <Text variant="caption" tone="subtle">{selectedPlan ? (inPlan ? t('admin.BusinessDetailScreen.in_name', { name: selectedPlan.name }) : t('admin.BusinessDetailScreen.not_in_name', { name: selectedPlan.name })) : ''}</Text>
              <Badge label={enabled ? t('common.on') : t('common.off')} tone={enabled ? 'success' : 'neutral'} icon={enabled ? 'checkmark' : 'close'} />
              {mode !== 'default' ? <Badge label={t('admin.BusinessDetailScreen.override')} tone="accent" /> : null}
              {enabled && hidden.has(f.key) ? <Badge label={t('admin.BusinessDetailScreen.hidden_by_owner')} tone="info" icon="eye-off-outline" /> : null}
            </View>
          );
          const heading = featureGroupHeading(b.features_catalog, i);
          return (
            <View key={f.key}>
              {heading ? <Text variant="caption" tone="subtle" style={{ textTransform: 'uppercase', paddingTop: i ? 14 : 4, paddingBottom: 4 }}>{heading}</Text> : null}
              {i > 0 && !heading ? <Divider /> : null}
              <View style={{ flexDirection: isPhone ? 'column' : 'row', alignItems: isPhone ? 'stretch' : 'center', gap: isPhone ? 8 : 12, paddingVertical: 10 }}>
                <View style={{ flex: isPhone ? undefined : 1, minWidth: 0, gap: 3 }}>
                  <Text variant="bodyStrong" numberOfLines={2}>{f.name}</Text>
                  {status}
                </View>
                {editable ? (
                  <View style={{ width: isPhone ? '100%' : 320 }}>
                    <Segmented size="sm" value={mode} options={FEATURE_MODES} onChange={(m) => onFeature(f.key, m)} />
                  </View>
                ) : null}
              </View>
            </View>
          );
        })}
      </View>
      {b.hidden_by_owner.length ? (
        <Text variant="small" tone="subtle">{t('admin.BusinessDetailScreen.hidden_by_owner_the_business_has_the')}</Text>
      ) : null}
    </Card>
  );
}

const LIMIT_MODES: { value: LimitMode; label: string }[] = [
  { value: 'plan', get label() { return t('common.plan'); } }, { value: 'custom', get label() { return t('common.custom'); } }, { value: 'unlimited', get label() { return t('admin.BusinessDetailScreen.unlimited'); } },
];

function LimitsCard({ business: b, form, selectedPlan, editable, onLimit }: {
  business: BusinessDetail; form: Draft; selectedPlan: PlanInfo | null; editable: boolean; onLimit: (key: LimitKey, l: LimitDraft) => void;
}) {
  const { isPhone } = useLayout();
  const usage: Partial<Record<LimitKey, number>> = { max_staff: b.staff_count, max_products: b.products };
  return (
    <Card style={{ gap: 14 }}>
      <CardTitle title={t('admin.BusinessDetailScreen.limits')} subtitle={t('admin.BusinessDetailScreen.use_the_plan_s_limits_set_a_custom_number')} />
      {LIMIT_KEYS.map((key, i) => {
        const l = form.limits[key];
        const planValue = selectedPlan ? selectedPlan.limits[key] : undefined;
        const effective = l.mode === 'plan' ? planValue : l.mode === 'unlimited' ? null : (/^\d+$/.test(l.value.trim()) ? Number(l.value.trim()) : undefined);
        const used = usage[key];
        const over = used !== undefined && typeof effective === 'number' && used > effective;
        return (
          <View key={key} style={{ gap: 8 }}>
            {i > 0 ? <Divider /> : null}
            <View style={{ flexDirection: isPhone ? 'column' : 'row', gap: isPhone ? 8 : 12, alignItems: isPhone ? 'stretch' : 'center' }}>
              <View style={{ flex: isPhone ? undefined : 1, minWidth: 0, gap: 2 }}>
                <Text variant="bodyStrong">{LIMIT_LABEL[key]}</Text>
                <Text variant="small" tone={over ? 'danger' : 'muted'}>
                  {effective === undefined ? '—' : limitText(effective)}
                  {used !== undefined ? t('admin.BusinessDetailScreen.using_tolocalestring', { toLocaleString: used.toLocaleString(currentLocale()) }) : ''}
                  {selectedPlan && l.mode !== 'plan' ? t('admin.BusinessDetailScreen.plan_limittext', { limitText: limitText(planValue) }) : ''}
                </Text>
              </View>
              {editable ? (
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start', width: isPhone ? '100%' : 380 }}>
                  <View style={{ flex: 1 }}>
                    <Segmented size="sm" value={l.mode} options={LIMIT_MODES}
                      onChange={(mode) => onLimit(key, { mode, value: mode === 'custom' ? (l.value || (typeof planValue === 'number' ? String(planValue) : '')) : '' })} />
                  </View>
                  {l.mode === 'custom' ? (
                    <Input value={l.value} onChangeText={(value) => onLimit(key, { mode: 'custom', value: value.replace(/[^0-9]/g, '') })}
                      keyboardType="number-pad" maxLength={7} containerStyle={{ width: 100 }} accessibilityLabel={t('admin.BusinessDetailScreen.v_limit', { v: LIMIT_LABEL[key] })}
                      error={limitError(l) ? ' ' : undefined} placeholder="0" />
                  ) : null}
                </View>
              ) : null}
            </View>
            {editable && limitError(l) ? <Text variant="small" tone="danger">{limitError(l)}</Text> : null}
            {over ? <Text variant="small" tone="danger">{t('admin.BusinessDetailScreen.already_above_this_limit_nothing_is')}</Text> : null}
          </View>
        );
      })}
    </Card>
  );
}

function StaffCard({ business: b }: { business: BusinessDetail }) {
  const active = b.staff.filter((s) => s.is_active).length;
  return (
    <Card style={{ gap: 8 }}>
      <CardTitle title={t('common.staff_logins')} subtitle={t('admin.BusinessDetailScreen.active_active_v_tolocalestring_products', { active, v: b.staff.length > active ? t('admin.BusinessDetailScreen.v_deactivated', { v: b.staff.length - active }) : '', toLocaleString: b.products.toLocaleString(currentLocale()) })} />
      {b.staff.length === 0 ? <Text variant="small" tone="subtle">{t('admin.BusinessDetailScreen.no_logins')}</Text> : null}
      {b.staff.map((s, i) => (
        <View key={s.id}>
          {i > 0 ? <Divider style={{ marginBottom: 8 }} /> : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text variant="bodyStrong" tone={s.is_active ? 'default' : 'muted'} numberOfLines={1}>{s.name || s.email}</Text>
              <Text variant="small" tone="muted" numberOfLines={1}>{s.email}</Text>
            </View>
            <Badge label={s.role.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())} tone={s.role === 'owner' ? 'accent' : 'neutral'} />
            {!s.is_active ? <Badge label={t('admin.BusinessDetailScreen.deactivated')} tone="danger" /> : null}
          </View>
        </View>
      ))}
    </Card>
  );
}

function detailsText(details: Record<string, unknown> | null): string {
  if (!details) return '';
  return Object.entries(details)
    .filter(([, v]) => v !== null && v !== undefined && !(Array.isArray(v) && v.length > 6))
    .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(' · ');
}

function ActivityCard({ entries, loading, error, onRetry }: { entries: AuditEntry[] | null; loading: boolean; error: string | null; onRetry: () => void }) {
  return (
    <Card style={{ gap: 8 }}>
      <CardTitle title={t('admin.BusinessDetailScreen.platform_activity')} subtitle={t('admin.BusinessDetailScreen.changes_brand_staff_made_to_this_business', { brand: brand.name })} />
      {loading && !entries ? <Loading /> : null}
      {error && !entries ? <ErrorState message={error} onRetry={onRetry} /> : null}
      {entries && entries.length === 0 ? <EmptyState icon="time-outline" title={t('admin.BusinessDetailScreen.nothing_yet')} message={t('admin.BusinessDetailScreen.plan_changes_payments_and_suspensions')} /> : null}
      {(entries ?? []).map((e, i) => (
        <View key={e.id} style={{ gap: 2 }}>
          {i > 0 ? <Divider style={{ marginBottom: 8 }} /> : null}
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <Text variant="smallStrong" style={{ flex: 1 }} numberOfLines={1}>{actionLabel(e.action)}</Text>
            <Text variant="caption" tone="subtle">{formatDateTime(e.created_at)}</Text>
          </View>
          {detailsText(e.details) ? <Text variant="small" tone="muted" numberOfLines={3}>{detailsText(e.details)}</Text> : null}
          <Text variant="caption" tone="subtle">{e.actor_email}</Text>
        </View>
      ))}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Sheets
// ---------------------------------------------------------------------------

const SUSPEND_REASONS = ['Payment pending', 'Requested by owner', 'Suspicious activity', 'Terms violation'];

function SuspendSheet({ business: b, onClose, onDone }: { business: BusinessDetail; onClose: () => void; onDone: (next: BusinessDetail) => void }) {
  const online = useOnline();
  const [reason, setReason] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const error = submitted && reason.trim().length < 3 ? t('admin.BusinessDetailScreen.give_a_short_reason_it_is_shown_in_the') : undefined;

  const submit = async () => {
    setSubmitted(true);
    if (reason.trim().length < 3) return;
    setSaving(true);
    try {
      const next = await platformApi.updateBusiness(b.id, { status: 'suspended', status_reason: reason.trim() });
      toast.success(t('admin.BusinessDetailScreen.name_suspended', { name: b.name }));
      onDone(next);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet visible onClose={onClose} title={t('admin.BusinessDetailScreen.suspend_name', { name: b.name })} width={520}
      footer={
        <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'flex-end' }}>
          <Button title={t('common.cancel')} variant="secondary" onPress={onClose} disabled={saving} />
          <Button title={t('admin.BusinessDetailScreen.suspend_business')} variant="danger" icon="pause-circle-outline" onPress={submit} loading={saving} disabled={!online} />
        </View>
      }>
      <Callout tone="danger">{t('admin.BusinessDetailScreen.the_owner_and_every_staff_login_are')}</Callout>
      <Input label={t('common.reason')} required value={reason} onChangeText={setReason} maxLength={200} error={error} autoFocus
        placeholder={t('admin.BusinessDetailScreen.e_g_payment_pending')} hint={t('admin.BusinessDetailScreen.starts_with_payment_recording_a_payment')} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {SUSPEND_REASONS.map((r) => (
          <Button key={r} title={r} size="sm" variant={reason === r ? 'soft' : 'secondary'} onPress={() => setReason(r)} />
        ))}
      </View>
    </Sheet>
  );
}
