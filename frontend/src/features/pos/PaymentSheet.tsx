import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { BusinessSettings, PaymentInput, PaymentMethod } from '@/api/types';
import { Button, Input, Sheet, Text, useHotkeys } from '@/components/ui';
import { QrCode } from '@/components/QrCode';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { money, round2 } from '@/lib/format';
import { PAYMENT_UI } from '@/lib/uiLabels';
import { buildUpiUrl } from '@/lib/print/receipt';
import { cashNotes, defaultPaymentMethod, methodToRemember } from './posLayout';
import { usePosPrefs } from './posPrefs';
import { t } from '@/i18n';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

export interface LoyaltyOption {
  available: number;
  pointValue: number;
  max: number;
  points: number;
  onChange: (points: number) => void;
}

const METHODS: { method: PaymentMethod; label: string; icon: IconName }[] = [
  { method: 'CASH', get label() { return t('common.cash'); }, icon: 'cash-outline' },
  { method: 'UPI', label: 'UPI', icon: 'qr-code-outline' },
  { method: 'CARD', get label() { return t('common.card'); }, icon: 'card-outline' },
  { method: 'OTHER', get label() { return t('common.other'); }, icon: 'wallet-outline' },
  { method: 'CREDIT', get label() { return t('pos.PaymentSheet.udhaar'); }, icon: 'book-outline' },
];

export function PaymentSheet({ visible, onClose, due: liveDue, currency, settings, hasCustomer, aggregator, loyalty, submitting, onConfirm, title, offerNote }: {
  visible: boolean;
  onClose: () => void;
  /** Amount still to collect on this bill. */
  due: number;
  currency: string;
  settings: BusinessSettings | null;
  hasCustomer: boolean;
  aggregator: boolean;
  loyalty: LoyaltyOption | null;
  submitting: boolean;
  onConfirm: (payments: PaymentInput[], change: number) => void;
  title?: string;
  /** e.g. "Includes Happy hours (−₹50.00)" — the offer already in the amount due. */
  offerNote?: string | null;
}) {
  const { colors, radius } = useTheme();
  const { isPhone } = useLayout();
  const [added, setAdded] = useState<PaymentInput[]>([]);
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [amountText, setAmountText] = useState('');
  const [reference, setReference] = useState('');
  const [pointsText, setPointsText] = useState('');
  const amountRef = useRef<TextInput>(null);
  // Freeze the amount while the sheet animates closed (the cart resets underneath it)
  const [frozenDue, setFrozenDue] = useState(liveDue);
  useEffect(() => { if (visible) setFrozenDue(liveDue); }, [visible, liveDue]);
  const due = visible ? liveDue : frozenDue;

  useEffect(() => {
    if (!visible) return;
    setAdded([]);
    // Starts on the method used last (cash with the exact amount for most counters)
    setMethod(defaultPaymentMethod({ aggregator, last: usePosPrefs.getState().lastMethod }));
    setAmountText('');
    setReference('');
    setPointsText(loyalty?.points ? String(loyalty.points) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const paidSoFar = round2(added.reduce((s, p) => s + p.amount, 0));
  const remaining = Math.max(0, round2(due - paidSoFar));
  const typed = amountText.trim() ? Number(amountText.replace(/,/g, '')) : NaN;
  const amount = Number.isFinite(typed) ? round2(typed) : remaining;
  const isCash = method === 'CASH';
  const overpay = !isCash && amount > remaining + 0.001;
  const invalid = !(amount > 0) || overpay || (method === 'CREDIT' && !hasCustomer);
  const covers = amount >= remaining - 0.001;
  const change = isCash && covers ? round2(amount - remaining) : 0;

  const methods = aggregator ? [{ method: 'AGGREGATOR' as PaymentMethod, label: t('pos.PaymentSheet.paid_online'), icon: 'cloud-done-outline' as IconName }, ...METHODS] : METHODS;

  const choose = (m: PaymentMethod) => {
    setMethod(m);
    setAmountText('');
    setReference('');
    if (Platform.OS === 'web') setTimeout(() => amountRef.current?.focus(), 30);
  };

  const complete = (payments: PaymentInput[], changeDue: number) => {
    const remember = methodToRemember(payments);
    if (remember) usePosPrefs.getState().set({ lastMethod: remember });
    onConfirm(payments, changeDue);
  };

  const primary = () => {
    if (submitting) return;
    if (remaining <= 0 && added.length) { complete(added, 0); return; }
    if (invalid) return;
    const payment: PaymentInput = { method, amount, reference: reference.trim() || null };
    if (covers) {
      complete([...added, payment], change);
    } else {
      setAdded((a) => [...a, payment]);
      setAmountText('');
      setReference('');
      setMethod('CASH');
    }
  };

  const applyPoints = (text: string) => {
    if (!loyalty) return;
    setPointsText(text);
    const n = Math.floor(Number(text) || 0);
    const clamped = Math.max(0, Math.min(n, loyalty.max));
    setAdded([]);
    loyalty.onChange(clamped);
  };

  const primaryLabel = remaining <= 0 && added.length ? 'Complete bill'
    : covers ? (change > 0 ? `Complete · change ${money(change, currency)}` : `Complete · ${money(amount, currency)} ${PAYMENT_UI[method] ?? method}`)
    : `Add ${money(amount, currency)} ${PAYMENT_UI[method] ?? method} · ${money(round2(remaining - amount), currency)} left`;

  const upiId = settings?.upi_id?.trim();

  // F8 / Ctrl+Enter complete the payment from anywhere in the sheet (Enter works in the amount box)
  useHotkeys({ 'F8|Ctrl+Enter': () => primary() }, [], { enabled: visible });

  return (
    <Sheet visible={visible} onClose={submitting ? () => {} : onClose} title={title ?? t('pos.PaymentSheet.collect_payment')} width={600} dismissable={!submitting}
      footer={
        <Button title={primaryLabel} size="lg" full icon={covers || remaining <= 0 ? 'checkmark-circle' : 'add-circle-outline'} shortcut="F8"
          variant={covers || remaining <= 0 ? 'success' : 'primary'} onPress={primary} loading={submitting}
          disabled={(invalid && !(remaining <= 0 && added.length)) || submitting} testID="pos-pay-confirm" />
      }>
      <View style={[styles.dueBox, { backgroundColor: colors.surfaceSunken, borderRadius: radius.lg }]}>
        <View style={{ flex: 1 }}>
          <Text variant="small" tone="muted">{added.length ? t('pos.PaymentSheet.still_to_collect') : t('pos.PaymentSheet.amount_due')}</Text>
          <Text variant="moneyLarge" style={{ fontSize: isPhone ? 32 : 38, lineHeight: isPhone ? 40 : 46 }}>{money(remaining, currency)}</Text>
        </View>
        {added.length ? (
          <View style={{ alignItems: 'flex-end' }}>
            <Text variant="small" tone="muted">{t('pos.PaymentSheet.bill_total')}</Text>
            <Text variant="money">{money(due, currency)}</Text>
          </View>
        ) : null}
      </View>

      {offerNote ? (
        <View style={[styles.offerNote, { backgroundColor: colors.successSoft, borderRadius: radius.md }]}>
          <Ionicons name="pricetag" size={15} color={colors.successText} />
          <Text variant="small" tone="success" style={{ flex: 1 }} numberOfLines={2}>{offerNote}</Text>
        </View>
      ) : null}

      {added.length ? (
        <View style={{ gap: 6 }}>
          {added.map((p, i) => (
            <View key={i} style={[styles.addedRow, { borderColor: colors.border, borderRadius: radius.md }]}>
              <Ionicons name="checkmark-circle" size={18} color={colors.success} />
              <Text variant="bodyStrong" style={{ flex: 1 }}>{PAYMENT_UI[p.method] ?? p.method}{p.reference ? ` · ${p.reference}` : ''}</Text>
              <Text variant="money">{money(p.amount, currency)}</Text>
              <Pressable onPress={() => setAdded((a) => a.filter((_, j) => j !== i))} accessibilityRole="button" accessibilityLabel={t('pos.PaymentSheet.remove_this_payment')} hitSlop={8}>
                <Ionicons name="close" size={18} color={colors.textMuted} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.methods} accessibilityRole="radiogroup">
        {methods.map((m) => {
          const active = m.method === method;
          const blocked = m.method === 'CREDIT' && !hasCustomer;
          return (
            <Pressable key={m.method} onPress={() => choose(m.method)} accessibilityRole="radio" accessibilityState={{ selected: active }}
              accessibilityLabel={m.label}
              style={({ hovered }: any) => [styles.method, {
                borderRadius: radius.md, borderWidth: active ? 2 : 1,
                borderColor: active ? colors.primary : hovered ? colors.borderStrong : colors.border,
                backgroundColor: active ? colors.primarySoft : colors.surface, opacity: blocked && !active ? 0.6 : 1,
              }, Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}>
              <Ionicons name={m.icon} size={22} color={active ? colors.primary : colors.textMuted} />
              <Text variant="smallStrong" color={active ? colors.primarySoftText : colors.text} numberOfLines={1}>{m.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {isCash ? (
        <View style={{ gap: 10 }}>
          <Input ref={amountRef} label={t('pos.PaymentSheet.cash_received')} prefix={currency} keyboardType="decimal-pad" value={amountText} onChangeText={setAmountText}
            placeholder={String(remaining)} onSubmitEditing={primary} autoFocus={Platform.OS === 'web'} style={{ fontSize: 20 }} />
          {/* Quick cash: exact, then the notes customers usually hand over */}
          <View style={styles.chips} accessibilityLabel={t('pos.PaymentSheet.cash_received')}>
            {cashNotes(remaining).map((v, i) => {
              const active = i === 0 ? !amountText || amount === v : amount === v && !!amountText;
              return (
                <Button key={v} title={i === 0 ? t('pos.PaymentSheet.exact_money', { money: money(v, currency, v % 1 === 0) }) : money(v, currency, true)} size="md"
                  variant={active ? 'tonal' : 'outline'} onPress={() => setAmountText(i === 0 ? '' : String(v))}
                  style={i === 0 ? styles.exact : styles.note} accessibilityLabel={i === 0 ? t('pos.PaymentSheet.exact_amount_money', { money: money(v, currency) }) : t('pos.PaymentSheet.customer_gave_money', { money: money(v, currency) })} />
              );
            })}
          </View>
          {change > 0 ? (
            <View style={[styles.change, { backgroundColor: colors.successSoft, borderRadius: radius.md }]}>
              <Text variant="bodyStrong" tone="success">{t('pos.PaymentSheet.return_change')}</Text>
              <Text variant="moneyLarge" tone="success">{money(change, currency)}</Text>
            </View>
          ) : amount > 0 && !covers ? (
            <Text variant="small" tone="muted">{t('pos.PaymentSheet.less_than_due_this_will_be_added_as_a')}</Text>
          ) : null}
        </View>
      ) : (
        <View style={{ gap: 10 }}>
          {method === 'UPI' ? (
            upiId ? (
              <View style={[styles.qrBox, { borderColor: colors.border, borderRadius: radius.lg }]}>
                <QrCode value={buildUpiUrl(upiId, settings?.business_name ?? 'Shop', amount > 0 ? amount : remaining)} size={isPhone ? 170 : 200} />
                <Text variant="smallStrong">{t('pos.PaymentSheet.scan_with_any_upi_app_to_pay')} {money(amount > 0 ? amount : remaining, currency)}</Text>
                <Text variant="small" tone="muted">{upiId}</Text>
              </View>
            ) : (
              <View style={[styles.hint, { backgroundColor: colors.infoSoft, borderRadius: radius.md }]}>
                <Ionicons name="information-circle" size={18} color={colors.info} />
                <Text variant="small" tone="info" style={{ flex: 1 }}>{t('pos.PaymentSheet.add_your_upi_id_in_settings_business_to')}</Text>
              </View>
            )
          ) : null}
          {method === 'CREDIT' && !hasCustomer ? (
            <View style={[styles.hint, { backgroundColor: colors.warningSoft, borderRadius: radius.md }]}>
              <Ionicons name="person-add-outline" size={18} color={colors.warning} />
              <Text variant="small" tone="warning" style={{ flex: 1 }}>{t('pos.PaymentSheet.credit_needs_a_customer_close_this_and')}</Text>
            </View>
          ) : null}
          <View style={styles.inline}>
            <Input ref={amountRef} label={t('common.amount')} prefix={currency} keyboardType="decimal-pad" value={amountText} onChangeText={setAmountText}
              placeholder={String(remaining)} containerStyle={{ flex: 1 }} onSubmitEditing={primary}
              error={overpay ? t('pos.PaymentSheet.max_money_only_cash_can_be_more_than_the', { money: money(remaining, currency) }) : null} />
            {method !== 'CREDIT' ? (
              <Input label={method === 'AGGREGATOR' ? t('pos.PaymentSheet.order_txn_id') : t('pos.PaymentSheet.reference_optional')} value={reference} onChangeText={setReference}
                placeholder={method === 'CARD' ? t('pos.PaymentSheet.last_4_digits') : method === 'UPI' ? 'UTR' : ''} containerStyle={{ flex: 1 }} maxLength={100} onSubmitEditing={primary} />
            ) : null}
          </View>
        </View>
      )}

      {loyalty && loyalty.available > 0 ? (
        <View style={[styles.loyalty, { borderColor: colors.border, borderRadius: radius.md }]}>
          <Ionicons name="star" size={18} color={colors.accent} />
          <View style={{ flex: 1 }}>
            <Text variant="smallStrong">{t('pos.PaymentSheet.redeem_points')}</Text>
            <Text variant="small" tone="muted">{loyalty.available} {t('pos.PaymentSheet.available_1_pt_money_max', { money: money(loyalty.pointValue, currency) })} {loyalty.max}</Text>
          </View>
          <TextInput value={pointsText} onChangeText={applyPoints} keyboardType="number-pad" placeholder="0" placeholderTextColor={colors.textSubtle}
            accessibilityLabel={t('pos.PaymentSheet.points_to_redeem')}
            style={[styles.pointsInput, { color: colors.text, borderColor: colors.border, borderRadius: radius.sm }, Platform.OS === 'web' && ({ outlineStyle: 'none' } as any)]} />
          <Button title={t('pos.PaymentSheet.max')} size="sm" variant="soft" onPress={() => applyPoints(String(loyalty.max))} disabled={!loyalty.max} />
        </View>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  dueBox: { flexDirection: 'row', alignItems: 'flex-end', padding: 16, gap: 12 },
  offerNote: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8 },
  addedRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10 },
  methods: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  method: { flexGrow: 1, flexBasis: 96, minHeight: 64, alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  note: { flexGrow: 1, flexBasis: 80 },
  exact: { flexGrow: 2, flexBasis: 150 },
  change: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10 },
  qrBox: { alignItems: 'center', gap: 6, padding: 16, borderWidth: 1 },
  hint: { flexDirection: 'row', gap: 8, padding: 12, alignItems: 'flex-start' },
  inline: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  loyalty: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, padding: 12 },
  pointsInput: { width: 72, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 6, fontSize: 15, textAlign: 'right' },
});
