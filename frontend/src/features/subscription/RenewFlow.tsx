/**
 * Renewal flow shared by the lock screen and Settings → Plan & billing:
 * pick a plan and duration → apply an offer (live quote) → pay by UPI / bank → "I've paid" with the UTR.
 * Storant checks the payment and switches the business on; the screens re-check GET /subscription until then.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ApiError, errorMessage } from '@/api/client';
import {
  subscriptionApi,
  type PaymentDetails,
  type PaymentMethod,
  type PaymentRequest,
  type Quote,
  type SubscriptionInfo,
  type SubscriptionOffer,
  type SubscriptionPeriod,
  type SubscriptionPlan,
} from '@/api/subscription';
import { Badge, Button, Card, IconButton, Input, Text, toast } from '@/components/ui';
import { QrCode } from '@/components/QrCode';
import { ChoiceChips, Callout, FieldRow, Hairline, copyText, monoFont } from '@/features/settings/components';
import { formatDate, money } from '@/lib/format';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { KIND_LABEL, METHOD_LABEL, REQUEST_STATUS, featureLabel, limitsText, monthsText, upiLink } from './format';
import { brand } from '@/config/brand';
import { t } from '@/i18n';

// ---------------------------------------------------------------------------
// Selection + live quote
// ---------------------------------------------------------------------------

function defaultMonths(plan: SubscriptionPlan | undefined): number {
  if (!plan?.options.length) return 1;
  return plan.options.find((o) => o.months === 12)?.months ?? [...plan.options].sort((a, b) => b.saving - a.saving)[0]!.months;
}

function useQuote(planKey: string | null, months: number, code: string) {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  useEffect(() => {
    if (!planKey) return undefined;
    const id = ++seq.current;
    setLoading(true);
    const timer = setTimeout(() => {
      subscriptionApi
        .quote({ plan_key: planKey, months, offer_code: code || null })
        .then((q) => { if (id === seq.current) { setQuote(q); setError(null); } })
        .catch((e) => { if (id === seq.current) setError(errorMessage(e)); })
        .finally(() => { if (id === seq.current) setLoading(false); });
    }, code ? 350 : 120);
    return () => clearTimeout(timer);
  }, [planKey, months, code]);
  return { quote, loading, error };
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function StepTitle({ n, title, hint }: { n: number; title: string; hint?: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <View style={[styles.step, { backgroundColor: colors.primarySoft }]}>
        <Text variant="smallStrong" color={colors.primarySoftText}>{n}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="h3" accessibilityRole="header">{title}</Text>
        {hint ? <Text variant="small" tone="muted">{hint}</Text> : null}
      </View>
    </View>
  );
}

function PlanCard({ plan, selected, current, onPress }: { plan: SubscriptionPlan; selected: boolean; current: boolean; onPress: () => void }) {
  const { colors, radius } = useTheme();
  const shown = plan.features.slice(0, 5);
  const more = plan.features.length - shown.length;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={t('subscription.RenewFlow.name_plan_money_a_month', { name: plan.name, money: money(plan.price_monthly, '₹', true) })}
      style={({ hovered }: any) => [
        styles.planCard,
        {
          borderRadius: radius.lg,
          borderColor: selected ? colors.primary : hovered ? colors.borderStrong : colors.border,
          backgroundColor: selected ? colors.primarySoft : colors.surface,
        },
        Platform.OS === 'web' && ({ cursor: 'pointer' } as any),
      ]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={20} color={selected ? colors.primary : colors.textSubtle} />
        <Text variant="h3" style={{ flex: 1 }} numberOfLines={1}>{plan.name}</Text>
        {current ? <Badge label={t('subscription.RenewFlow.your_plan')} tone="primary" /> : null}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
        <Text variant="moneyLarge">{money(plan.price_monthly, '₹', true)}</Text>
        <Text variant="small" tone="muted">/ month</Text>
      </View>
      {plan.description ? <Text variant="small" tone="muted">{plan.description}</Text> : null}
      <Text variant="smallStrong">{limitsText(plan.limits)}</Text>
      <View style={{ gap: 4 }}>
        {shown.map((f) => (
          <View key={f} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Ionicons name="checkmark" size={14} color={colors.success} />
            <Text variant="small" numberOfLines={1}>{featureLabel(f)}</Text>
          </View>
        ))}
        {more > 0 ? <Text variant="small" tone="subtle">{t('subscription.RenewFlow.more_more', { more })}</Text> : null}
      </View>
    </Pressable>
  );
}

function DurationTile({ label, price, perMonth, saving, months, selected, onPress }: {
  label: string; price: number; perMonth: number; saving: number; months: number; selected: boolean; onPress: () => void;
}) {
  const { colors, radius } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={`${label}, ${money(price, '₹', true)}${saving ? t('subscription.RenewFlow.save_money', { money: money(saving, '₹', true) }) : ''}`}
      style={({ hovered }: any) => [
        styles.duration,
        {
          borderRadius: radius.md,
          borderColor: selected ? colors.primary : hovered ? colors.borderStrong : colors.border,
          backgroundColor: selected ? colors.primarySoft : colors.surface,
        },
        Platform.OS === 'web' && ({ cursor: 'pointer' } as any),
      ]}
    >
      <Text variant="smallStrong" color={selected ? colors.primarySoftText : colors.text} numberOfLines={1}>{label}</Text>
      <Text variant="money">{money(price, '₹', true)}</Text>
      <Text variant="caption" tone="muted">{months > 1 ? t('subscription.RenewFlow.money_month_monthstext', { money: money(perMonth, '₹', true), monthsText: monthsText(months) }) : t('subscription.RenewFlow.1_month')}</Text>
      {saving > 0 ? <Badge label={t('subscription.RenewFlow.save_money_2', { money: money(saving, '₹', true) })} tone="success" style={{ marginTop: 2 }} /> : null}
    </Pressable>
  );
}

function OfferRow({ offer, active, onApply }: { offer: SubscriptionOffer; active: boolean; onApply: () => void }) {
  const { colors, radius } = useTheme();
  return (
    <View style={[styles.offer, { borderColor: active ? colors.success : colors.border, borderRadius: radius.md, backgroundColor: active ? colors.successSoft : colors.surfaceAlt }]}>
      <Ionicons name="pricetag-outline" size={18} color={active ? colors.successText : colors.accentText} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Text variant="smallStrong" style={{ fontFamily: monoFont }} selectable>{offer.code}</Text>
          <Text variant="small" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>{offer.name}</Text>
        </View>
        <Text variant="small">{offer.description || offer.summary}</Text>
        <Text variant="caption" tone="subtle">
          {offer.summary}{offer.ends_at ? t('subscription.RenewFlow.until_formatdate', { formatDate: formatDate(offer.ends_at) }) : ''}{offer.new_businesses_only ? t('subscription.RenewFlow.first_paid_subscription_only') : ''}
        </Text>
      </View>
      {active ? <Badge label={t('subscription.RenewFlow.applied')} tone="success" icon="checkmark" /> : <Button title={t('common.apply')} size="sm" variant="secondary" onPress={onApply} />}
    </View>
  );
}

function QuoteLine({ label, value, tone, strong }: { label: string; value: string; tone?: 'success' | 'muted'; strong?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
      <Text variant={strong ? 'bodyStrong' : 'small'} tone={tone === 'muted' ? 'muted' : undefined}>{label}</Text>
      <Text variant={strong ? 'money' : 'small'} tone={tone === 'success' ? 'success' : undefined}>{value}</Text>
    </View>
  );
}

/** UPI ID (copy, QR on big screens, open-in-UPI-app on phones), bank details and instructions. */
export function PaymentCard({ payment, amount, note }: { payment: PaymentDetails; amount: number | null; note: string }) {
  const { colors, radius } = useTheme();
  const { isPhone } = useLayout();
  const hasUpi = !!payment.upi_id?.trim();
  const link = hasUpi ? upiLink({ upiId: payment.upi_id.trim(), payee: payment.payee_name, amount, note }) : '';

  const openUpi = async () => {
    try {
      await Linking.openURL(link);
    } catch {
      toast.warning(t('subscription.RenewFlow.no_upi_app_found_pay_to_the_upi_id_shown'));
    }
  };

  return (
    <View style={{ gap: 14 }}>
      {payment.instructions ? <Text variant="small" tone="muted">{payment.instructions}</Text> : null}
      {hasUpi ? (
        <View style={{ flexDirection: isPhone ? 'column' : 'row', gap: 16, alignItems: isPhone ? 'stretch' : 'center' }}>
          <View style={{ flex: 1, gap: 8, minWidth: 0 }}>
            <Text variant="caption" tone="subtle" style={{ textTransform: 'uppercase' }}>{t('subscription.RenewFlow.pay_by_upi')}</Text>
            <View style={[styles.copyBox, { borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceSunken }]}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text variant="bodyStrong" style={{ fontFamily: monoFont }} selectable numberOfLines={1}>{payment.upi_id}</Text>
                {payment.payee_name ? <Text variant="small" tone="muted" numberOfLines={1}>{payment.payee_name}</Text> : null}
              </View>
              <IconButton icon="copy-outline" accessibilityLabel={t('subscription.RenewFlow.copy_upi_id')} onPress={() => void copyText(payment.upi_id, 'UPI ID')} />
            </View>
            {amount ? <Text variant="small">{t('subscription.RenewFlow.amount')} <Text variant="smallStrong">{money(amount)}</Text></Text> : null}
            {isPhone ? <Button title={amount ? t('subscription.RenewFlow.pay_money_in_a_upi_app', { money: money(amount, '₹', true) }) : t('subscription.RenewFlow.open_a_upi_app')} icon="phone-portrait-outline" onPress={openUpi} full /> : null}
          </View>
          {!isPhone ? (
            <View style={{ alignItems: 'center', gap: 6 }}>
              <View style={{ padding: 8, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border }}>
                <QrCode value={link} size={132} />
              </View>
              <Text variant="caption" tone="subtle">{t('subscription.RenewFlow.scan_with_any_upi_app')}</Text>
            </View>
          ) : null}
        </View>
      ) : null}
      {payment.bank_details?.trim() ? (
        <View style={{ gap: 8 }}>
          <Text variant="caption" tone="subtle" style={{ textTransform: 'uppercase' }}>{t('common.bank_transfer')}</Text>
          <View style={[styles.copyBox, { borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceSunken, alignItems: 'flex-start' }]}>
            <Text variant="small" selectable style={{ flex: 1, minWidth: 0, fontFamily: monoFont }}>{payment.bank_details}</Text>
            <IconButton icon="copy-outline" accessibilityLabel={t('subscription.RenewFlow.copy_bank_details')} onPress={() => void copyText(payment.bank_details, 'Bank details')} />
          </View>
        </View>
      ) : null}
      {!hasUpi && !payment.bank_details?.trim() ? (
        <Callout tone="neutral">{t('subscription.RenewFlow.contact_brand_support_below_for_payment', { brand: brand.name })}</Callout>
      ) : null}
    </View>
  );
}

/** Phone and email of Storant billing support. */
export function SupportLinks({ payment }: { payment: PaymentDetails | null | undefined }) {
  const phone = payment?.support_phone?.trim();
  const email = payment?.support_email?.trim();
  if (!phone && !email) return null;
  const open = (url: string) => Linking.openURL(url).catch(() => toast.info(url.replace(/^(tel|mailto):/, '')));
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {phone ? <Button title={phone} icon="call-outline" variant="secondary" size="sm" onPress={() => void open(`tel:${phone.replace(/\s+/g, '')}`)} /> : null}
      {email ? <Button title={email} icon="mail-outline" variant="secondary" size="sm" onPress={() => void open(`mailto:${email}?subject=${encodeURIComponent(`${brand.name} subscription`)}`)} /> : null}
    </View>
  );
}

/** Payment claims the owner sent: pending, approved, or rejected with Storant's reason. */
export function RequestsList({ requests, plans, limit = 5 }: { requests: PaymentRequest[]; plans: SubscriptionPlan[]; limit?: number }) {
  if (!requests.length) return null;
  const name = (key: string) => plans.find((p) => p.key === key)?.name ?? key;
  return (
    <View style={{ gap: 10 }}>
      {requests.slice(0, limit).map((r, i) => {
        const st = REQUEST_STATUS[r.status] ?? REQUEST_STATUS.pending;
        return (
          <View key={r.id} style={{ gap: 6 }}>
            {i > 0 ? <Hairline /> : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', paddingTop: i > 0 ? 6 : 0 }}>
              <Text variant="bodyStrong" style={{ flexShrink: 1 }}>{name(r.plan_key)} · {monthsText(r.months)}</Text>
              <Badge label={st.label} tone={st.tone} />
              <View style={{ flex: 1 }} />
              <Text variant="money">{money(r.amount)}</Text>
            </View>
            <Text variant="small" tone="muted">
              {METHOD_LABEL[r.method] ?? r.method} {t('subscription.RenewFlow.ref')} <Text variant="small" style={{ fontFamily: monoFont }} selectable>{r.reference}</Text>
              {r.offer_code ? t('subscription.RenewFlow.offer_offer_code', { offer_code: r.offer_code }) : ''} {t('subscription.RenewFlow.sent_formatdate', { formatDate: formatDate(r.created_at) })}
            </Text>
            {r.status === 'rejected' ? (
              <Callout tone="danger" title={t('common.reason')}>{r.review_note || t('subscription.RenewFlow.brand_could_not_match_this_payment_check', { brand: brand.name })}</Callout>
            ) : r.review_note ? (
              <Text variant="small" tone="muted">{t('subscription.RenewFlow.note_from_brand', { brand: brand.name })} {r.review_note}</Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

/** Past and current subscription periods. */
export function HistoryList({ history }: { history: SubscriptionPeriod[] }) {
  if (!history.length) return <Text tone="muted">{t('subscription.RenewFlow.no_subscription_periods_yet')}</Text>;
  const now = Date.now();
  return (
    <View style={{ gap: 10 }}>
      {history.map((h, i) => {
        const start = new Date(h.start_date).getTime();
        const end = new Date(h.end_date).getTime();
        const running = start <= now && now < end;
        return (
          <View key={h.id} style={{ gap: 4 }}>
            {i > 0 ? <Hairline /> : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', paddingTop: i > 0 ? 6 : 0 }}>
              <Text variant="bodyStrong" style={{ flexShrink: 1 }}>{h.plan_name ?? t('common.plan')}{h.months ? ` · ${monthsText(h.months)}` : ''}</Text>
              <Badge label={KIND_LABEL[h.kind] ?? h.kind} tone={h.kind === 'paid' ? 'primary' : h.kind === 'trial' ? 'info' : 'neutral'} />
              {running ? <Badge label={t('common.current')} tone="success" /> : null}
              <View style={{ flex: 1 }} />
              <Text variant="money">{h.amount_paid ? money(h.amount_paid) : '—'}</Text>
            </View>
            <Text variant="small" tone="muted">
              {formatDate(h.start_date)} – {formatDate(h.end_date)}{h.offer ? ` · ${h.offer}` : ''}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// "I've paid" form
// ---------------------------------------------------------------------------

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'upi', label: 'UPI' }, { value: 'bank_transfer', get label() { return t('common.bank_transfer'); } }, { value: 'card', get label() { return t('common.card'); } },
  { value: 'cash', get label() { return t('common.cash'); } }, { value: 'cheque', get label() { return t('common.cheque'); } }, { value: 'other', get label() { return t('common.other'); } },
];

function ClaimForm({ planKey, months, offerCode, quote, onSubmitted }: {
  planKey: string; months: number; offerCode: string | null; quote: Quote | null; onSubmitted: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [amountTouched, setAmountTouched] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>('upi');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  // Follow the quote until the owner types an amount of their own
  useEffect(() => {
    if (!amountTouched && quote) setAmount(quote.amount ? String(quote.amount) : '');
  }, [quote, amountTouched]);

  const value = Number(amount.replace(/[,₹\s]/g, ''));
  const errors = {
    amount: !amount.trim() ? 'Enter the amount you paid.' : !Number.isFinite(value) || value <= 0 ? 'Enter a valid amount.' : undefined,
    reference: reference.trim().length < 4
      ? (method === 'upi' || method === 'bank_transfer' ? 'Enter the UTR / reference number from your payment app or bank (at least 4 characters).' : 'Enter a receipt or reference number (at least 4 characters).')
      : undefined,
  };
  const mismatch = quote && Number.isFinite(value) && value > 0 && Math.abs(value - quote.amount) >= 1;

  const submit = async () => {
    setSubmitted(true);
    setServerError(null);
    if (errors.amount || errors.reference) return;
    setSaving(true);
    try {
      await subscriptionApi.claim({
        plan_key: planKey, months, offer_code: offerCode, amount: value, method, reference: reference.trim(), note: note.trim() || null,
      });
      toast.success(t('subscription.RenewFlow.thanks_we_ll_confirm_your_payment_shortly'));
      setReference('');
      setNote('');
      setSubmitted(false);
      setAmountTouched(false);
      onSubmitted();
    } catch (e) {
      if (e instanceof ApiError && [400, 409, 429].includes(e.status)) setServerError(e.message);
      else toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={{ gap: 14 }}>
      <FieldRow>
        <Input label={t('subscription.RenewFlow.amount_paid')} value={amount} prefix="₹" keyboardType="decimal-pad" maxLength={10}
          onChangeText={(v) => { setAmount(v); setAmountTouched(true); }}
          error={submitted ? errors.amount : undefined}
          hint={mismatch ? t('subscription.RenewFlow.the_price_for_this_choice_is_money', { money: money(quote!.amount) }) : undefined} />
        <Input label={t('subscription.RenewFlow.utr_reference_number')} value={reference} onChangeText={(v) => { setReference(v); setServerError(null); }}
          autoCapitalize="characters" autoCorrect={false} maxLength={100} placeholder={t('subscription.RenewFlow.e_g_4092_8177_3112')}
          error={submitted ? errors.reference : undefined} required />
      </FieldRow>
      <View style={{ gap: 6 }}>
        <Text variant="smallStrong" tone="muted">{t('subscription.RenewFlow.paid_by')}</Text>
        <ChoiceChips value={method} options={METHODS} onChange={setMethod} accessibilityLabel={t('subscription.RenewFlow.payment_method')} />
      </View>
      <Input label={t('subscription.RenewFlow.note_for_brand_optional', { brand: brand.name })} value={note} onChangeText={setNote} maxLength={300} placeholder={t('subscription.RenewFlow.e_g_paid_from_phonepe_name_on_account')} />
      {serverError ? <Callout tone="danger">{serverError}</Callout> : null}
      <Button title={t('subscription.RenewFlow.i_ve_paid_send_for_confirmation')} icon="checkmark-done" onPress={submit} loading={saving} style={{ alignSelf: 'flex-start' }} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// The flow
// ---------------------------------------------------------------------------

export function RenewFlow({ info, onSubmitted, allowTwoColumns = true }: {
  info: SubscriptionInfo; onSubmitted: () => void;
  /** Put "choose" and "pay" side by side on wide screens (the full-page lock screen; not inside settings). */
  allowTwoColumns?: boolean;
}) {
  const { colors } = useTheme();
  const { width, isPhone } = useLayout();
  const twoCol = allowTwoColumns && width >= 1180;
  const plans = info.plans;
  const initialPlan = plans.find((p) => p.key === info.plan_key) ?? plans[0];
  const [planKey, setPlanKey] = useState<string | null>(initialPlan?.key ?? null);
  const plan = plans.find((p) => p.key === planKey) ?? initialPlan;
  const [months, setMonths] = useState<number>(defaultMonths(initialPlan));
  const [codeInput, setCodeInput] = useState('');
  const [code, setCode] = useState('');
  const { quote, loading: quoting, error: quoteError } = useQuote(plan?.key ?? null, months, code);

  // Keep the duration valid when switching plans (plans can offer different durations)
  useEffect(() => {
    if (plan && !plan.options.some((o) => o.months === months)) setMonths(defaultMonths(plan));
  }, [plan, months]);

  const applyCode = (c: string) => {
    const clean = c.trim().toUpperCase();
    setCodeInput(clean);
    setCode(clean);
  };
  const offerValid = !!code && !!quote && quote.offer_error == null && quote.offer?.code === code;
  const pending = info.requests.filter((r) => r.status === 'pending');
  const note = useMemo(() => `${brand.name} ${plan?.name ?? ''} ${monthsText(months)}`.trim(), [plan, months]);

  if (!plans.length || !plan) {
    return <Callout tone="neutral">{t('subscription.RenewFlow.no_plans_are_available_right_now_contact', { brand: brand.name })}</Callout>;
  }

  const choose = (
    <Card style={{ gap: 18 }}>
      <StepTitle n={1} title={t('subscription.RenewFlow.choose_a_plan')} hint={t('subscription.RenewFlow.you_can_change_plans_at_any_renewal')} />
      <View style={{ flexDirection: isPhone ? 'column' : 'row', flexWrap: 'wrap', gap: 12 }} accessibilityRole="radiogroup">
        {plans.map((p) => (
          <View key={p.key} style={isPhone ? undefined : { flexGrow: 1, flexBasis: 220, minWidth: 0 }}>
            <PlanCard plan={p} selected={p.key === plan.key} current={p.key === info.plan_key} onPress={() => setPlanKey(p.key)} />
          </View>
        ))}
      </View>
      <Hairline />
      <StepTitle n={2} title={t('subscription.RenewFlow.how_long')} hint={t('subscription.RenewFlow.longer_periods_cost_less_per_month')} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }} accessibilityRole="radiogroup">
        {plan.options.map((o) => (
          <View key={o.months} style={{ flexGrow: 1, flexBasis: isPhone ? '45%' : 150, minWidth: 0 }}>
            <DurationTile label={o.label} price={o.price} perMonth={o.per_month} saving={o.saving} months={o.months}
              selected={o.months === months} onPress={() => setMonths(o.months)} />
          </View>
        ))}
      </View>
      <Hairline />
      <StepTitle n={3} title={t('subscription.RenewFlow.offer_code')} hint={t('subscription.RenewFlow.optional_codes_are_checked_as_you_type')} />
      {info.offers.length ? (
        <View style={{ gap: 8 }}>
          {info.offers.map((o) => (
            <OfferRow key={o.id} offer={o} active={offerValid && quote?.offer?.code === o.code} onApply={() => applyCode(o.code)} />
          ))}
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Input value={codeInput} onChangeText={(v) => { setCodeInput(v.toUpperCase()); if (!v.trim()) setCode(''); }}
            placeholder={t('subscription.RenewFlow.enter_offer_code')} autoCapitalize="characters" autoCorrect={false} maxLength={40} icon="pricetag-outline"
            onSubmitEditing={() => applyCode(codeInput)} accessibilityLabel={t('subscription.RenewFlow.offer_code')}
            error={code && quote?.offer_error && !quoting ? quote.offer_error : undefined} />
        </View>
        {code && code === codeInput.trim() ? (
          <Button title={t('common.remove')} variant="ghost" onPress={() => applyCode('')} />
        ) : (
          <Button title={t('common.apply')} variant="secondary" onPress={() => applyCode(codeInput)} disabled={!codeInput.trim()} />
        )}
      </View>
      <View style={[styles.summary, { backgroundColor: colors.surfaceSunken }]}>
        {quoteError ? <Text variant="small" tone="danger">{quoteError}</Text> : null}
        <QuoteLine label={`${plan.name} · ${monthsText(months)}`} value={quote ? money(quote.list_price) : '…'} />
        {quote && quote.discount > 0 ? <QuoteLine label={t('subscription.RenewFlow.offer_v', { v: quote.offer?.code ?? '' })} value={`− ${money(quote.discount)}`} tone="success" /> : null}
        {quote && quote.extra_days > 0 ? <QuoteLine label={t('subscription.RenewFlow.extra_days_free')} value={`+ ${quote.extra_days} days`} tone="success" /> : null}
        <Hairline />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <Text variant="bodyStrong">{t('subscription.RenewFlow.amount_to_pay')}</Text>
          <Text variant="moneyLarge" style={{ opacity: quoting ? 0.5 : 1 }}>{quote ? money(quote.amount) : '…'}</Text>
        </View>
      </View>
    </Card>
  );

  const pay = (
    <Card style={{ gap: 18 }}>
      <StepTitle n={4} title={t('common.pay')} hint={quote ? t('subscription.RenewFlow.pay_money_to_brand', { money: money(quote.amount), brand: brand.name }) : undefined} />
      <PaymentCard payment={info.payment} amount={quote?.amount ?? null} note={note} />
      <Hairline />
      <StepTitle n={5} title={t('subscription.RenewFlow.tell_us_you_ve_paid')} hint={t('subscription.RenewFlow.brand_checks_the_payment_and_switches', { brand: brand.name })} />
      {pending.length ? (
        <Callout tone="info" title={t('subscription.RenewFlow.length_payment_v_waiting_for_confirmation', { length: pending.length, v: pending.length === 1 ? '' : 's' })}>
          {t('subscription.RenewFlow.you_don_t_need_to_send_it_again_send')}
        </Callout>
      ) : null}
      <ClaimForm planKey={plan.key} months={months} offerCode={offerValid ? code : null} quote={quote} onSubmitted={onSubmitted} />
    </Card>
  );

  if (twoCol) {
    return (
      <View style={{ flexDirection: 'row', gap: 20, alignItems: 'flex-start' }}>
        <View style={{ flex: 1.15, minWidth: 0 }}>{choose}</View>
        <View style={{ flex: 1, minWidth: 0 }}>{pay}</View>
      </View>
    );
  }
  return (
    <View style={{ gap: 16 }}>
      {choose}
      {pay}
    </View>
  );
}

const styles = StyleSheet.create({
  step: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  planCard: { borderWidth: 1.5, padding: 16, gap: 8, minHeight: 44 },
  duration: { borderWidth: 1.5, paddingVertical: 12, paddingHorizontal: 14, gap: 2, minHeight: 44 },
  offer: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderWidth: 1 },
  copyBox: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 12, paddingRight: 4, paddingVertical: 6, borderWidth: 1 },
  summary: { gap: 8, padding: 14, borderRadius: 12 },
});
