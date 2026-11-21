/**
 * Business page: subscription access (demo / development / active / grace / locked), signed-in devices, payment history and
 * the "Record payment" sheet (plan durations, offer code with a live quote, kind, goodwill days).
 */
import React, { useEffect, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { errorMessage } from '@/api/client';
import {
  platformApi,
  type BusinessDetail, type DeviceSession, type PaymentMethod, type PlanInfo, type Quote, type RecordKind, type SubscriptionRecord,
} from '@/api/platform';
import { Badge, Button, Card, Chip, Divider, EmptyState, ErrorState, Input, Loading, Segmented, Sheet, Text, confirm, prompt, toast } from '@/components/ui';
import { useApi } from '@/hooks/useApi';
import { ago, formatDateTime, money } from '@/lib/format';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { Callout, ChoiceChips, FieldRow, KeyValue, SettingSwitch } from '@/features/settings/components';
import {
  ACCESS_LABEL, AccessBadge, KIND_LABEL, KIND_TONE, PAYMENT_METHODS, PAYMENT_METHOD_LABEL, accessDaysText, plural, shortDate, useOnline,
} from './shared';
import { t } from '@/i18n';

const DAY = 86_400_000;

function CardTitle({ title, subtitle, right }: { title: string; subtitle?: string; right?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
      <View style={{ flex: 1, minWidth: 180 }}>
        <Text variant="h3" accessibilityRole="header">{title}</Text>
        {subtitle ? <Text variant="small" tone="muted">{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------

const DEMO_CHOICES = [7, 14, 30];

function accessHeadline(b: BusinessDetail): { title: string; detail: string } {
  const a = b.access;
  const kind = a.kind ? KIND_LABEL[a.kind] : null;
  switch (a.state) {
    case 'trial':
      return { title: t('admin.BusinessAccess.free_demo_accessdaystext', { accessDaysText: accessDaysText(a) }), detail: t('admin.BusinessAccess.until_shortdate_locks_then_unless_a', { shortDate: shortDate(a.paid_until) }) };
    case 'development':
      return { title: t('common.development_access'), detail: t('admin.BusinessAccess.works_with_no_expiry_until_you_switch_it') };
    case 'active':
      return { title: `${kind && a.kind !== 'paid' ? kind : t('common.active')} · ${accessDaysText(a)}`, detail: t('admin.BusinessAccess.paid_until_shortdate', { shortDate: shortDate(a.paid_until) }) };
    case 'grace':
      return { title: t('admin.BusinessAccess.grace_period'), detail: t('admin.BusinessAccess.the_paid_period_ended_shortdate_locks_on', { shortDate: shortDate(a.paid_until), shortDate2: shortDate(a.lock_at ?? a.paid_until) }) };
    default:
      return {
        title: t('common.locked'),
        detail: a.paid_until
          ? t('admin.BusinessAccess.subscription_ended_shortdate_v_the_owner', { shortDate: shortDate(a.paid_until), v: b.lapsed_at ? t('admin.BusinessAccess.devices_signed_out_shortdate', { shortDate: shortDate(b.lapsed_at) }) : '' })
          : t('admin.BusinessAccess.no_demo_or_payment_yet_the_owner_sees_the'),
      };
  }
}

export function AccessCard({ business: b, editable, online, onRecordPayment, onChanged }: {
  business: BusinessDetail; editable: boolean; online: boolean; onRecordPayment: () => void; onChanged: (next?: BusinessDetail) => void;
}) {
  const { colors, radius } = useTheme();
  const [days, setDays] = useState('14');
  const [busy, setBusy] = useState<null | 'demo' | 'dev'>(null);
  const a = b.access;
  const head = accessHeadline(b);
  const daysNum = /^\d+$/.test(days.trim()) ? Number(days.trim()) : NaN;
  const daysError = !(daysNum >= 1 && daysNum <= 365) ? '1–365 days.' : undefined;
  const tone = a.state === 'lapsed' ? colors.dangerSoft : a.state === 'grace' ? colors.warningSoft : a.state === 'development' ? colors.accentSoft
    : a.state === 'trial' ? colors.infoSoft : colors.successSoft;
  const fg = a.state === 'lapsed' ? colors.dangerText : a.state === 'grace' ? colors.warningText : a.state === 'development' ? colors.accentText
    : a.state === 'trial' ? colors.infoText : colors.successText;
  const icon = a.state === 'lapsed' ? 'lock-closed' : a.state === 'grace' ? 'alert-circle' : a.state === 'development' ? 'construct' : a.state === 'trial' ? 'hourglass' : 'checkmark-circle';

  const giveDemo = async () => {
    if (daysError) return;
    const ok = await confirm({
      title: t('admin.BusinessAccess.give_name_a_daysnum_day_demo', { name: b.name, daysNum }), confirmLabel: t('admin.BusinessAccess.give_demo'),
      message: a.state === 'lapsed' || a.state === 'grace'
        ? t('admin.BusinessAccess.the_business_is_switched_on_straight_away')
        : t('admin.BusinessAccess.adds_daysnum_days_after_the_current_end', { daysNum, shortDate: shortDate(a.paid_until) }),
    });
    if (!ok) return;
    setBusy('demo');
    try {
      const r = await platformApi.giveDemo(b.id, { days: daysNum });
      toast.success(r ? t('admin.BusinessAccess.daysnum_day_demo_given_works_until', { daysNum, shortDate: shortDate(r.paid_until) }) : t('admin.BusinessAccess.demo_given'));
      onChanged();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const setDevelopment = async (enabled: boolean) => {
    const ok = await confirm(enabled ? {
      title: t('admin.BusinessAccess.give_development_access'), confirmLabel: t('admin.BusinessAccess.turn_on'),
      message: t('admin.BusinessAccess.name_works_with_no_expiry_until_you', { name: b.name }),
    } : {
      title: t('admin.BusinessAccess.remove_development_access'), confirmLabel: t('admin.BusinessAccess.turn_off'), danger: true,
      message: t('admin.BusinessAccess.the_development_period_ends_now_if'),
    });
    if (!ok) return;
    setBusy('dev');
    try {
      const next = await platformApi.setDevelopment(b.id, { enabled });
      toast.success(enabled ? t('admin.BusinessAccess.development_access_is_on') : t('admin.BusinessAccess.development_access_removed'));
      onChanged(next);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card style={{ gap: 14 }}>
      <CardTitle title={t('admin.BusinessAccess.access')} subtitle={t('admin.BusinessAccess.whether_the_business_can_sign_in_and_bill')} right={<AccessBadge access={a} />} />
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center', padding: 12, borderRadius: radius.md, backgroundColor: tone }}>
        <Ionicons name={icon} size={26} color={fg} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text variant="bodyStrong" color={fg}>{head.title}</Text>
          <Text variant="small" color={colors.text}>{head.detail}</Text>
        </View>
        {a.state !== 'development' && a.state !== 'lapsed' && a.days_left !== null ? (
          <View style={{ alignItems: 'center', minWidth: 56 }}>
            <Text variant="h1" color={fg}>{a.days_left}</Text>
            <Text variant="caption" color={fg}>{t('admin.BusinessAccess.days_left')}</Text>
          </View>
        ) : null}
      </View>
      {b.status === 'suspended' ? <Text variant="small" tone="danger">{t('admin.BusinessAccess.suspended_nobody_can_sign_in_whatever_the')}</Text> : null}
      {editable && (a.state === 'lapsed' || a.state === 'grace') ? (
        <Button title={t('admin.BusinessAccess.record_payment_to_unlock')} icon="card-outline" variant="success" onPress={onRecordPayment} disabled={!online} style={{ alignSelf: 'flex-start' }} />
      ) : null}

      {editable ? (
        <>
          <Divider />
          {b.development ? (
            <Text variant="small" tone="muted">{t('admin.BusinessAccess.development_access_is_on_so_a_demo_isn_t')}</Text>
          ) : (
            <View style={{ gap: 8 }}>
              <View>
                <Text variant="bodyStrong">{t('admin.BusinessAccess.give_a_free_demo')}</Text>
                <Text variant="small" tone="muted">{t('admin.BusinessAccess.extends_a_running_period_or_unlocks_a')}</Text>
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'flex-start' }}>
                <ChoiceChips value={Number.isFinite(daysNum) && DEMO_CHOICES.includes(daysNum) ? String(daysNum) : ''} onChange={setDays} accessibilityLabel={t('common.demo_length')}
                  options={DEMO_CHOICES.map((d) => ({ value: String(d), label: t('admin.BusinessAccess.d_days', { d }) }))} />
                <Input value={days} onChangeText={(v) => setDays(v.replace(/[^0-9]/g, ''))} keyboardType="number-pad" maxLength={3}
                  containerStyle={{ width: 84 }} accessibilityLabel={t('admin.BusinessAccess.custom_demo_days')} error={daysError ? ' ' : undefined} placeholder={t('common.days')} />
                <Button title={Number.isFinite(daysNum) && !daysError ? t('admin.BusinessAccess.give_daysnum_day_demo', { daysNum }) : t('admin.BusinessAccess.give_demo')} icon="gift-outline" variant="secondary"
                  onPress={giveDemo} loading={busy === 'demo'} disabled={!online || !!daysError || busy !== null} />
              </View>
              {daysError && days ? <Text variant="small" tone="danger">{daysError}</Text> : null}
            </View>
          )}
          <Divider />
          <SettingSwitch title={t('common.development_access')} value={b.development} onValueChange={(v) => void setDevelopment(v)} disabled={!online || busy !== null}
            subtitle={b.development ? t('admin.BusinessAccess.on_no_expiry_until_you_switch_it_off') : t('admin.BusinessAccess.for_internal_or_pilot_owners_works_with')} />
        </>
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------

const DEVICE_PREVIEW = 5;

function deviceIcon(device: string): keyof typeof Ionicons.glyphMap {
  const d = device.toLowerCase();
  if (d.includes('android') || d.includes('iphone') || d.includes('app')) return 'phone-portrait-outline';
  if (d.includes('windows') || d.includes('mac') || d.includes('linux')) return 'desktop-outline';
  return 'globe-outline';
}

function roleLabel(role: string | null): string {
  return (role ?? 'staff').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

export function DevicesCard({ business: b, editable }: { business: BusinessDetail; editable: boolean }) {
  const { colors } = useTheme();
  const { isPhone } = useLayout();
  const online = useOnline();
  const [showEnded, setShowEnded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const sessions = useApi(() => platformApi.sessions(b.id, showEnded), [b.id, showEnded]);
  const allRows = sessions.data ?? [];
  const rows = showAll ? allRows : allRows.slice(0, DEVICE_PREVIEW);
  const active = allRows.filter((s) => !s.revoked_at);

  const signOutAll = async () => {
    const reason = await prompt({
      title: t('admin.BusinessAccess.sign_out_every_device_of_name', { name: b.name }), confirmLabel: t('admin.BusinessAccess.sign_out_everywhere'), danger: true, minLength: 2,
      message: t('admin.BusinessAccess.everyone_owner_and_staff_is_signed_out'),
      label: t('admin.BusinessAccess.reason_kept_in_the_audit_log'), placeholder: b.access.locked ? t('admin.BusinessAccess.e_g_subscription_unpaid') : t('admin.BusinessAccess.e_g_owner_asked_lost_tablet'),
    });
    if (!reason?.trim()) return;
    setBusy('all');
    try {
      const r = await platformApi.signOutBusiness(b.id, reason.trim());
      toast.success(r.signed_out ? t('admin.BusinessAccess.signed_out_plural', { plural: plural(r.signed_out, 'device') }) : t('admin.BusinessAccess.signed_out_no_tracked_devices_were_active'));
      void sessions.silentReload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const signOutOne = async (s: DeviceSession) => {
    const reason = await prompt({
      title: t('admin.BusinessAccess.sign_out_v', { v: s.name ?? s.email ?? t('admin.BusinessAccess.this_device') }), confirmLabel: t('common.sign_out'), danger: true, minLength: 2,
      message: t('admin.BusinessAccess.device_v_they_need_to_sign_in_again_on', { device: s.device, v: s.ip ? ` · ${s.ip}` : '' }),
      label: t('common.reason'), placeholder: t('admin.BusinessAccess.e_g_lost_phone'),
    });
    if (!reason?.trim()) return;
    setBusy(s.id);
    try {
      await platformApi.revokeSession(s.id, reason.trim());
      toast.success(t('admin.BusinessAccess.device_signed_out'));
      void sessions.silentReload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card style={{ gap: 10 }}>
      <CardTitle title={t('admin.BusinessAccess.signed_in_devices')}
        subtitle={sessions.data ? (active.length ? t('admin.BusinessAccess.plural_signed_in', { plural: plural(active.length, 'device') }) : t('admin.BusinessAccess.no_devices_signed_in')) : t('admin.BusinessAccess.phones_tablets_and_browsers_using_this')}
        right={editable && active.length ? (
          <Button title={isPhone ? t('admin.BusinessAccess.sign_out_all') : t('admin.BusinessAccess.sign_out_everywhere')} icon="log-out-outline" variant="danger" size="sm" onPress={signOutAll}
            loading={busy === 'all'} disabled={!online || busy !== null} />
        ) : undefined} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Chip label={t('admin.BusinessAccess.include_signed_out')} icon={showEnded ? 'checkmark' : 'time-outline'} selected={showEnded} onPress={() => setShowEnded((v) => !v)} />
      </View>
      {sessions.loading && !sessions.data ? <Loading /> : null}
      {sessions.error && !sessions.data ? <ErrorState message={sessions.error} onRetry={sessions.reload} /> : null}
      {sessions.data && rows.length === 0 ? (
        <EmptyState icon="phone-portrait-outline" title={t('admin.BusinessAccess.no_devices')} message={t('admin.BusinessAccess.devices_appear_here_when_the_owner_or')} />
      ) : null}
      {rows.map((s, i) => {
        const ended = !!s.revoked_at;
        return (
          <View key={s.id}>
            {i > 0 ? <Divider style={{ marginBottom: 10 }} /> : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, opacity: ended ? 0.7 : 1 }}>
              <Ionicons name={deviceIcon(s.device)} size={22} color={ended ? colors.textSubtle : colors.textMuted} />
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <Text variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>{s.name ?? s.email ?? t('admin.BusinessAccess.unknown_user')}</Text>
                  <Badge label={roleLabel(s.role)} tone={s.role === 'owner' ? 'accent' : 'neutral'} />
                  {ended ? <Badge label={t('admin.BusinessAccess.signed_out')} tone="neutral" /> : null}
                </View>
                <Text variant="small" tone="muted" numberOfLines={1}>{s.device}{s.ip ? ` · ${s.ip}` : ''}</Text>
                <Text variant="caption" tone="subtle" numberOfLines={2}>
                  {ended
                    ? t('admin.BusinessAccess.signed_out_formatdatetime_v', { formatDateTime: formatDateTime(s.revoked_at), v: s.revoked_reason ? ` · ${s.revoked_reason}` : '' })
                    : t('admin.BusinessAccess.active_v_signed_in_formatdatetime', { v: s.last_seen_at ? t('admin.BusinessAccess.ago_ago', { ago: ago(s.last_seen_at) }) : 'recently', formatDateTime: formatDateTime(s.created_at) })}
                </Text>
              </View>
              {editable && !ended ? (
                <Button title={isPhone ? undefined : t('common.sign_out')} icon="log-out-outline" size="sm" variant="ghost" accessibilityLabel={t('admin.BusinessAccess.sign_out_v_2', { v: s.name ?? 'device' })}
                  onPress={() => void signOutOne(s)} loading={busy === s.id} disabled={!online || busy !== null} />
              ) : null}
            </View>
          </View>
        );
      })}
      {allRows.length > DEVICE_PREVIEW ? (
        <Button title={showAll ? t('admin.BusinessAccess.show_fewer') : t('admin.BusinessAccess.show_all_length', { length: allRows.length })} size="sm" variant="ghost" icon={showAll ? 'chevron-up' : 'chevron-down'}
          onPress={() => setShowAll((v) => !v)} style={{ alignSelf: 'flex-start' }} />
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Payment history
// ---------------------------------------------------------------------------

function periodText(s: SubscriptionRecord): string {
  const start = new Date(s.start_date).getTime();
  const end = new Date(s.end_date).getTime();
  if (s.kind === 'development' || new Date(s.end_date).getUTCFullYear() >= 2099) return `from ${shortDate(s.start_date)} · no expiry`;
  const span = s.months ? `${s.months} month${s.months === 1 ? '' : 's'}` : `${Math.max(0, Math.round((end - start) / DAY))} days`;
  return `${span} · ${shortDate(s.start_date)} → ${shortDate(s.end_date)}`;
}

export function PaymentsCard({ business: b, planName, editable, online, onRecord }: {
  business: BusinessDetail; planName: string; editable: boolean; online: boolean; onRecord: () => void;
}) {
  const received = b.subscriptions.reduce((n, s) => n + (Number(s.amount_paid) || 0), 0);
  const a = b.access;
  return (
    <Card style={{ gap: 12 }}>
      <CardTitle title={t('admin.BusinessAccess.subscription_payments')}
        subtitle={a.paid_until ? `${planName} · ${a.state === 'development' ? t('admin.BusinessAccess.development_access_2') : t('admin.BusinessAccess.tolowercase_until_shortdate', { toLowerCase: ACCESS_LABEL[a.state].toLowerCase(), shortDate: shortDate(a.paid_until) })}` : t('admin.BusinessAccess.no_demo_or_payment_recorded_yet')}
        right={editable ? <Button title={t('admin.BusinessAccess.record_payment')} icon="add" size="sm" onPress={onRecord} disabled={!online} /> : undefined} />
      {a.state === 'active' && a.days_left !== null && a.days_left <= 7 ? (
        <Callout tone="warning">{t('admin.BusinessAccess.renewal_due')} {a.days_left === 0 ? 'today' : t('admin.BusinessAccess.in_plural', { plural: plural(a.days_left, 'day') })}.</Callout>
      ) : null}
      {b.subscriptions.length === 0 ? (
        <Text variant="small" tone="subtle">{t('admin.BusinessAccess.payments_demos_and_complimentary_periods')}</Text>
      ) : (
        <View>
          {b.subscriptions.map((s, i) => {
            const kind = s.kind ?? 'paid';
            return (
              <View key={s.id ?? `${s.start_date}-${i}`}>
                {i > 0 ? <Divider /> : null}
                <View style={{ paddingVertical: 10, gap: 4 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <Text variant="bodyStrong" style={{ flex: 1, minWidth: 90 }} numberOfLines={1}>
                      {kind === 'paid' || Number(s.amount_paid) ? money(Number(s.amount_paid) || 0) : KIND_LABEL[kind]}
                    </Text>
                    <Badge label={KIND_LABEL[kind] ?? kind} tone={KIND_TONE[kind] ?? 'neutral'} />
                    {s.payment_method && s.payment_method !== 'free' ? <Badge label={PAYMENT_METHOD_LABEL[s.payment_method] ?? s.payment_method} tone="neutral" /> : null}
                    {s.offer ? <Badge label={s.offer.code ?? s.offer.name} tone="accent" icon="gift-outline" /> : null}
                  </View>
                  <Text variant="small" tone="muted">{s.plan_name ?? s.plan_key} · {periodText(s)}</Text>
                  {kind === 'paid' && (s.discount || s.extra_days || (s.list_price && Number(s.list_price) !== Number(s.amount_paid))) ? (
                    <Text variant="small" tone="subtle">
                      {[s.list_price ? `List ${money(s.list_price)}` : null, s.discount ? `offer −${money(s.discount)}` : null,
                        s.extra_days ? `+${s.extra_days} days free` : null].filter(Boolean).join(' · ')}
                    </Text>
                  ) : null}
                  {s.payment_reference || s.note ? (
                    <Text variant="small" tone="subtle" selectable numberOfLines={2}>
                      {s.payment_reference ? t('admin.BusinessAccess.ref_payment_reference', { payment_reference: s.payment_reference }) : ''}{s.payment_reference && s.note ? ' · ' : ''}{s.note ?? ''}
                    </Text>
                  ) : null}
                  {s.recorded_by ? <Text variant="caption" tone="subtle">{t('admin.BusinessAccess.by')} {s.recorded_by}{s.paid_at ? ` · ${shortDate(s.paid_at.endsWith('Z') ? s.paid_at : `${s.paid_at}Z`)}` : ''}</Text> : null}
                </View>
              </View>
            );
          })}
          <Divider style={{ marginVertical: 6 }} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text variant="smallStrong" tone="muted">{t('admin.BusinessAccess.total_received')}</Text>
            <Text variant="smallStrong">{money(received)}</Text>
          </View>
        </View>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Record payment
// ---------------------------------------------------------------------------

const NEEDS_REFERENCE: PaymentMethod[] = ['upi', 'bank_transfer', 'card', 'cheque'];
const KINDS: { value: RecordKind; label: string }[] = [
  { value: 'paid', get label() { return t('common.paid'); } }, { value: 'complimentary', get label() { return t('common.complimentary'); } }, { value: 'trial', get label() { return t('common.demo'); } },
];
const GOODWILL_CHOICES = [0, 7, 15, 30];

function useDebounced<T>(value: T, ms = 400): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

function DurationTile({ title, price, sub, saving, selected, onPress }: {
  title: string; price?: string; sub?: string; saving?: string; selected: boolean; onPress: () => void;
}) {
  const { colors, radius } = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="radio" accessibilityState={{ checked: selected }} accessibilityLabel={`${title}${price ? ` ${price}` : ''}`}
      style={({ hovered }: any) => [
        { flexGrow: 1, flexBasis: 150, minHeight: 64, padding: 10, borderRadius: radius.md, borderWidth: 1, gap: 2,
          borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? colors.primarySoft : hovered ? colors.surfaceSunken : colors.surface },
        Platform.OS === 'web' && ({ cursor: 'pointer' } as any),
      ]}>
      <Text variant="smallStrong" color={selected ? colors.primarySoftText : colors.text} numberOfLines={1}>{title}</Text>
      {price ? <Text variant="bodyStrong" color={selected ? colors.primarySoftText : colors.text}>{price}</Text> : null}
      {sub ? <Text variant="caption" tone="subtle" numberOfLines={1}>{sub}</Text> : null}
      {saving ? <Text variant="caption" tone="success" numberOfLines={1}>{saving}</Text> : null}
    </Pressable>
  );
}

export function RecordPaymentSheet({ business: b, plans, onClose, onDone }: { business: BusinessDetail; plans: PlanInfo[]; onClose: () => void; onDone: () => void }) {
  const online = useOnline();
  const options = plans.filter((p) => p.is_active || p.key === b.plan_key);
  const [planKey, setPlanKey] = useState(options.some((p) => p.key === b.plan_key) ? b.plan_key : options[0]?.key ?? b.plan_key);
  const plan = plans.find((p) => p.key === planKey) ?? null;
  const priceOptions = plan?.price_options ?? [];
  const [kind, setKind] = useState<RecordKind>('paid');
  const [months, setMonths] = useState(() => String((priceOptions.find((o) => o.months === 12) ?? priceOptions[priceOptions.length - 1])?.months ?? 12));
  const [custom, setCustom] = useState(false);
  const [offerCode, setOfferCode] = useState('');
  const [goodwill, setGoodwill] = useState('0');
  const [amount, setAmount] = useState('');
  const [amountTouched, setAmountTouched] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>('upi');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [quote, setQuote] = useState<{ loading: boolean; data: Quote | null; error: string | null }>({ loading: false, data: null, error: null });

  const monthsNum = /^\d+$/.test(months.trim()) ? Number(months.trim()) : NaN;
  const goodwillNum = /^\d+$/.test(goodwill.trim()) ? Number(goodwill.trim()) : NaN;
  const option = priceOptions.find((o) => o.months === monthsNum) ?? null;
  const listPrice = option ? option.price : plan && Number.isFinite(monthsNum) ? Math.round(plan.price_monthly * monthsNum * 100) / 100 : 0;
  const code = offerCode.trim().toUpperCase();
  const debouncedCode = useDebounced(code);
  const paid = kind === 'paid';

  // Live quote for the offer code (the server checks dates, plans, minimum months, first-payment rules)
  useEffect(() => {
    if (!paid || !debouncedCode || !Number.isFinite(monthsNum) || monthsNum < 1 || monthsNum > 60) {
      setQuote({ loading: false, data: null, error: null });
      return undefined;
    }
    let cancelled = false;
    setQuote((q) => ({ ...q, loading: true }));
    platformApi.quote(b.id, { plan_key: planKey, months: monthsNum, offer_code: debouncedCode })
      .then((data) => { if (!cancelled) setQuote({ loading: false, data, error: null }); })
      .catch((e) => { if (!cancelled) setQuote({ loading: false, data: null, error: errorMessage(e) }); });
    return () => { cancelled = true; };
  }, [paid, debouncedCode, planKey, monthsNum, b.id]);

  const quoteFresh = !!quote.data && quote.data.plan_key === planKey && quote.data.months === monthsNum && code === debouncedCode;
  const offerOk = paid && !!code && quoteFresh && !quote.data!.offer_error && !!quote.data!.offer;
  const offerError = paid && code && quoteFresh ? quote.data!.offer_error : paid && code && quote.error && code === debouncedCode ? quote.error : null;
  const discount = offerOk ? quote.data!.discount : 0;
  const offerDays = offerOk ? quote.data!.extra_days : 0;
  const due = paid ? Math.max(0, Math.round((listPrice - discount) * 100) / 100) : 0;

  // Suggested amount follows the price until the admin types their own
  useEffect(() => {
    if (!amountTouched) setAmount(String(due));
  }, [due, amountTouched]);

  const changeKind = (k: RecordKind) => {
    setKind(k);
    setMethod(k === 'paid' ? 'upi' : 'free');
    setAmountTouched(false);
  };

  const amountNum = Number(amount.replace(/,/g, '').trim());
  const errors = {
    months: !(monthsNum >= 1 && monthsNum <= 60) ? 'Between 1 and 60 months.' : undefined,
    goodwill: !(goodwillNum >= 0 && goodwillNum <= 365) ? '0–365 days.' : undefined,
    amount: amount.trim() === '' || !Number.isFinite(amountNum) || amountNum < 0 ? 'Enter the amount received (0 for free).' : amountNum > 10_000_000 ? 'Too large.' : undefined,
    reference: paid && NEEDS_REFERENCE.includes(method) && !reference.trim() ? 'Add the UTR / transaction or cheque number.' : undefined,
    offer: offerError ? `${offerError}. Fix or clear the code.` : paid && code && (quote.loading || code !== debouncedCode) ? 'Checking the code…' : undefined,
  };
  const show = (k: keyof typeof errors) => (submitted ? errors[k] : undefined);

  // Mirrors the backend: continues from the current paid-until date (or today if it has ended)
  const paidUntil = b.access.paid_until ? new Date(b.access.paid_until).getTime() : 0;
  const start = Math.max(paidUntil, Date.now());
  const totalDays = (Number.isFinite(monthsNum) ? monthsNum * 30 : 0) + (Number.isFinite(goodwillNum) ? goodwillNum : 0) + offerDays;
  const end = new Date(start + totalDays * DAY);

  const submit = async () => {
    setSubmitted(true);
    setFormError(null);
    if (Object.values(errors).some(Boolean)) return;
    setSaving(true);
    try {
      const r = await platformApi.recordSubscription(b.id, {
        plan_key: planKey, months: monthsNum, amount_paid: amountNum, payment_method: method, kind,
        payment_reference: reference.trim() || null, note: note.trim() || null,
        offer_code: offerOk ? code : null, extra_days: goodwillNum || 0,
      });
      toast.success(t('admin.BusinessAccess.v_recorded_works_until_shortdate', { v: KIND_LABEL[kind], shortDate: shortDate(r.paid_until) }));
      onDone();
    } catch (e) {
      setFormError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const pickMonths = (m: number) => {
    setCustom(false);
    setMonths(String(m));
  };

  return (
    <Sheet visible onClose={onClose} title={t('admin.BusinessAccess.record_payment')} subtitle={t('admin.BusinessAccess.name_renewal_new_subscription_or_a_free', { name: b.name })} width={680}
      footer={
        <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'wrap' }}>
          <Text variant="smallStrong" tone="muted" style={{ flex: 1, minWidth: 160 }}>
            {Number.isFinite(amountNum) ? t('admin.BusinessAccess.money_until_shortdate', { money: money(amountNum), shortDate: shortDate(end.toISOString()) }) : ''}
          </Text>
          <Button title={t('common.cancel')} variant="secondary" onPress={onClose} disabled={saving} />
          <Button title={paid ? t('admin.BusinessAccess.record_payment') : t('admin.BusinessAccess.record_tolowercase', { toLowerCase: KIND_LABEL[kind].toLowerCase() })} icon="checkmark" onPress={submit} loading={saving}
            disabled={!online || !plans.length} />
        </View>
      }>
      {formError ? <Callout tone="danger">{formError}</Callout> : null}

      <View style={{ gap: 6 }}>
        <Text variant="smallStrong" tone="muted">{t('admin.BusinessAccess.type')}</Text>
        <View style={{ maxWidth: 440 }}>
          <Segmented value={kind} options={KINDS} onChange={changeKind} />
        </View>
        <Text variant="small" tone="subtle">
          {kind === 'paid' ? t('admin.BusinessAccess.money_received_for_a_plan') : kind === 'complimentary' ? t('admin.BusinessAccess.a_free_period_you_give_goodwill_partner') : t('admin.BusinessAccess.a_free_demo_period_of_the_chosen_plan')}
        </Text>
      </View>

      <View style={{ gap: 6 }}>
        <Text variant="smallStrong" tone="muted">{t('common.plan')}</Text>
        {options.length ? (
          <ChoiceChips value={planKey} onChange={(k) => {
            setPlanKey(k);
            setAmountTouched(false);
            const next = plans.find((p) => p.key === k)?.price_options ?? [];
            if (!custom && next.length && !next.some((o) => o.months === monthsNum)) {
              setMonths(String((next.find((o) => o.months === 12) ?? next[next.length - 1])!.months));
            }
          }} accessibilityLabel={t('common.plan')}
            options={options.map((p) => ({ value: p.key, label: t('admin.BusinessAccess.name_money_mo', { name: p.name, money: money(p.price_monthly, '₹', true) }) }))} />
        ) : <Text variant="small" tone="danger">{t('admin.BusinessAccess.plans_couldn_t_be_loaded_close_and')}</Text>}
        {planKey !== b.plan_key ? <Text variant="small" tone="warning">{t('admin.BusinessAccess.the_business_moves_to_this_plan_when_you')}</Text> : null}
      </View>

      <View style={{ gap: 6 }}>
        <Text variant="smallStrong" tone="muted">{t('admin.BusinessAccess.duration')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} accessibilityRole="radiogroup">
          {priceOptions.map((o) => (
            <DurationTile key={o.months} title={o.label} selected={!custom && monthsNum === o.months} onPress={() => pickMonths(o.months)}
              price={paid ? money(o.price, '₹', true) : `${o.months} month${o.months === 1 ? '' : 's'}`}
              sub={paid && o.months > 1 ? `${money(o.per_month, '₹', true)}/mo` : undefined}
              saving={paid && o.saving > 0 ? `Save ${money(o.saving, '₹', true)}` : undefined} />
          ))}
          <DurationTile title={t('common.custom')} selected={custom || (!option && Number.isFinite(monthsNum))} onPress={() => setCustom(true)}
            sub={t('admin.BusinessAccess.any_number_of_months_x')} price={custom || !option ? (Number.isFinite(monthsNum) ? `${monthsNum} mo` : '—') : undefined} />
        </View>
        {custom || !option ? (
          <Input label={t('admin.BusinessAccess.months')} value={months} onChangeText={(v) => { setCustom(true); setMonths(v.replace(/[^0-9]/g, '')); }} keyboardType="number-pad" maxLength={2}
            containerStyle={{ maxWidth: 160 }} error={show('months')} hint={paid && plan ? t('admin.BusinessAccess.money_months', { money: money(plan.price_monthly, '₹', true) }) : undefined} />
        ) : null}
      </View>

      {paid ? (
        <View style={{ gap: 6 }}>
          <Input label={t('admin.BusinessAccess.offer_code')} value={offerCode} onChangeText={(v) => setOfferCode(v.toUpperCase().replace(/[^A-Z0-9_-]/g, ''))} maxLength={30}
            autoCapitalize="characters" autoCorrect={false} placeholder={t('admin.BusinessAccess.e_g_diwali25')} containerStyle={{ maxWidth: 320 }}
            right={offerCode ? <Button icon="close" size="sm" variant="ghost" accessibilityLabel={t('admin.BusinessAccess.clear_offer_code')} onPress={() => setOfferCode('')} /> : undefined} />
          {code && (quote.loading || code !== debouncedCode) ? <Text variant="small" tone="subtle">{t('admin.BusinessAccess.checking_the_code')}</Text> : null}
          {offerOk ? (
            <Callout tone="success" icon="gift-outline" title={t('admin.BusinessAccess.name_applied', { name: quote.data!.offer!.name })}>
              {`${quote.data!.offer!.summary}: ${discount ? `−${money(discount)}` : t('admin.BusinessAccess.no_discount')}${offerDays ? t('admin.BusinessAccess.offerdays_days_free', { offerDays }) : ''}`}
            </Callout>
          ) : null}
          {offerError ? <Callout tone="danger">{`${code}: ${offerError}`}</Callout> : null}
        </View>
      ) : null}

      <View style={{ gap: 6 }}>
        <Text variant="smallStrong" tone="muted">{t('admin.BusinessAccess.extra_goodwill_days')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'flex-start' }}>
          <ChoiceChips value={Number.isFinite(goodwillNum) && GOODWILL_CHOICES.includes(goodwillNum) ? String(goodwillNum) : ''} onChange={setGoodwill}
            accessibilityLabel={t('admin.BusinessAccess.extra_goodwill_days')} options={GOODWILL_CHOICES.map((d) => ({ value: String(d), label: d === 0 ? t('common.none') : t('admin.BusinessAccess.d_days_2', { d }) }))} />
          <Input value={goodwill} onChangeText={(v) => setGoodwill(v.replace(/[^0-9]/g, ''))} keyboardType="number-pad" maxLength={3}
            containerStyle={{ width: 84 }} accessibilityLabel={t('admin.BusinessAccess.custom_goodwill_days')} error={show('goodwill') ? ' ' : undefined} />
        </View>
        {show('goodwill') ? <Text variant="small" tone="danger">{show('goodwill')}</Text> : null}
      </View>

      <Card style={{ gap: 2 }}>
        {paid ? <KeyValue label={t('admin.BusinessAccess.list_price')} value={Number.isFinite(monthsNum) ? `${money(listPrice)}${option ? ` · ${option.label}` : ''}` : '—'} /> : null}
        {paid && discount ? <KeyValue label={t('admin.BusinessAccess.offer_discount')} value={`−${money(discount)}`} /> : null}
        {paid ? <KeyValue label={t('admin.BusinessAccess.amount_due')} value={money(due)} /> : null}
        <KeyValue label={t('admin.BusinessAccess.period')} value={`${Number.isFinite(monthsNum) ? `${monthsNum} mo` : '—'}${goodwillNum ? ` + ${goodwillNum} d goodwill` : ''}${offerDays ? ` + ${offerDays} d offer` : ''}`} />
        <KeyValue label={t('admin.BusinessAccess.covers')} value={`${shortDate(new Date(start).toISOString())} → ${shortDate(end.toISOString())}`} />
      </Card>

      <FieldRow>
        <Input label={t('admin.BusinessAccess.amount_received')} required prefix="₹" value={amount} onChangeText={(v) => { setAmountTouched(true); setAmount(v.replace(/[^0-9.]/g, '')); }}
          keyboardType="decimal-pad" maxLength={11} error={show('amount')}
          hint={amountTouched && paid && Number.isFinite(amountNum) && Math.abs(amountNum - due) >= 0.5 ? t('admin.BusinessAccess.differs_from_the_amount_due_money', { money: money(due) }) : undefined} />
        <Input label={t('admin.BusinessAccess.reference')} value={reference} onChangeText={setReference} maxLength={100} error={show('reference')}
          placeholder={t('admin.BusinessAccess.utr_transaction_no')} autoCapitalize="characters" required={paid && NEEDS_REFERENCE.includes(method)} />
      </FieldRow>
      <View style={{ gap: 6 }}>
        <Text variant="smallStrong" tone="muted">{t('admin.BusinessAccess.payment_method')}</Text>
        <ChoiceChips value={method} onChange={setMethod} accessibilityLabel={t('admin.BusinessAccess.payment_method')} options={PAYMENT_METHODS} />
      </View>
      <Input label={t('admin.BusinessAccess.note_optional')} value={note} onChangeText={setNote} maxLength={300} placeholder={t('admin.BusinessAccess.e_g_paid_at_the_pune_expo')} />
      {submitted && errors.offer ? <Text variant="small" tone="danger">{errors.offer}</Text> : null}
      {b.access.locked ? <Callout tone="success">{t('admin.BusinessAccess.this_business_is_locked_recording_this')}</Callout> : null}
      {b.status === 'suspended' && (b.status_reason ?? '').toLowerCase().startsWith('payment') ? (
        <Callout tone="success">{t('admin.BusinessAccess.this_business_was_suspended_for_payment')}</Callout>
      ) : null}
    </Sheet>
  );
}
