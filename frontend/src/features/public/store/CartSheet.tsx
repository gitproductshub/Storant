import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Link } from 'expo-router';
import { useTheme } from '@/theme/ThemeProvider';
import { Button, Input, Segmented, Sheet, Text, VegMark } from '@/components/ui';
import { Notice } from '../PublicPage';
import { normaliseIndianMobile, pickPayment, tableName, type CartLine, type CustomerDetails, type OrderMode, price } from './model';
import type { PaymentChoice } from './api';
import { Stepper } from './parts';
import { t as tr } from '@/i18n';

export interface CheckoutInput extends CustomerDetails { phoneDigits: string; notes: string; payment: PaymentChoice }

const PAYMENT_TEXT: Record<PaymentChoice, { title: string; body: string; icon: keyof typeof Ionicons.glyphMap }> = {
  counter: { get title() { return tr('public.store_CartSheet.pay_at_the_counter_to_the_waiter'); }, get body() { return tr('public.store_CartSheet.cash_card_or_upi_when_you_re_done'); }, icon: 'cash-outline' },
  upi: { get title() { return tr('public.store_CartSheet.pay_now_by_upi'); }, get body() { return tr('public.store_CartSheet.gpay_phonepe_paytm_or_any_upi_app_right'); }, icon: 'phone-portrait-outline' },
};

const ONLY_COUNTER: PaymentChoice[] = ['counter'];

export function CartSheet({
  visible, onClose, lines, symbol, pricesIncludeTax, businessName, mode, tableLabel, initialDetails,
  onChangeQty, onChangeNotes, onClear, onPlace, payments = ONLY_COUNTER, defaultPayment, existingBill,
}: {
  visible: boolean; onClose: () => void; lines: CartLine[]; symbol: string; pricesIncludeTax: boolean; businessName: string;
  mode: OrderMode; tableLabel: string | null; initialDetails: CustomerDetails | null;
  /** Table QR: the payment options the shop allows, and the customer's previous choice */
  payments?: PaymentChoice[]; defaultPayment?: PaymentChoice | null;
  /** Table QR: the open bill this order will be added to (when the same phone number is used) */
  existingBill?: { code: string; phone: string | null } | null;
  onChangeQty: (key: string, qty: number) => void; onChangeNotes: (key: string, notes: string) => void; onClear: () => void;
  /** Resolves to an error message, or null on success. */
  onPlace: (input: CheckoutInput) => Promise<string | null>;
}) {
  const { colors, radius } = useTheme();
  const [step, setStep] = useState<'cart' | 'details'>('cart');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [orderType, setOrderType] = useState<'TAKEAWAY' | 'DELIVERY'>('TAKEAWAY');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [payment, setPayment] = useState<PaymentChoice>(() => pickPayment(payments, defaultPayment));
  const [errors, setErrors] = useState<{ name?: string; phone?: string; address?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
  const [noteOpen, setNoteOpen] = useState<Record<string, boolean>>({});
  const phoneRef = useRef<TextInput>(null);

  useEffect(() => {
    if (!visible) return;
    setStep('cart');
    setFormError(null);
    setErrors({});
    if (initialDetails) {
      setName((v) => v || initialDetails.name);
      setPhone((v) => v || initialDetails.phone);
      setAddress((v) => v || initialDetails.address);
      setOrderType(initialDetails.orderType);
    }
    setPayment((p) => pickPayment(payments, defaultPayment ?? p));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    if (visible && lines.length === 0) onClose();
  }, [visible, lines.length, onClose]);

  const count = lines.reduce((n, l) => n + l.qty, 0);
  const subtotal = lines.reduce((n, l) => n + l.price * l.qty, 0);
  const phoneDigits = normaliseIndianMobile(phone);
  const addingToBill = mode === 'QR' && !!existingBill && (!existingBill.phone || !phoneDigits || existingBill.phone === phoneDigits);
  const taxNote = pricesIncludeTax ? 'Prices include GST' : 'GST will be added as applicable';

  const validate = () => {
    const next: typeof errors = {};
    if (!name.trim()) next.name = tr('public.store_CartSheet.please_enter_your_name');
    else if (name.trim().length > 80) next.name = tr('public.store_CartSheet.name_is_too_long');
    if (!phone.trim()) next.phone = tr('public.store_CartSheet.please_enter_your_mobile_number');
    else if (!normaliseIndianMobile(phone)) next.phone = tr('public.store_CartSheet.enter_a_valid_10_digit_indian_mobile');
    if (mode === 'ONLINE' && orderType === 'DELIVERY' && address.trim().length < 10) next.address = tr('public.store_CartSheet.please_enter_your_full_delivery_address');
    setErrors(next);
    return !next.name && !next.phone && !next.address;
  };

  const place = async () => {
    setFormError(null);
    if (!validate()) return;
    setPlacing(true);
    try {
      const err = await onPlace({
        name: name.trim(), phone: phone.trim(), phoneDigits: normaliseIndianMobile(phone)!, orderType,
        address: address.trim(), notes: notes.trim(), payment: pickPayment(payments, payment),
      });
      if (err) setFormError(err);
    } finally {
      setPlacing(false);
    }
  };

  const footer = step === 'cart' ? (
    <Button title={tr('public.store_CartSheet.continue_price', { price: price(subtotal, symbol) })} size="lg" full onPress={() => setStep('details')} iconRight="arrow-forward" disabled={!lines.length} />
  ) : (
    <View style={{ gap: 10 }}>
      {formError ? <Notice tone="danger">{formError}</Notice> : null}
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Button title={tr('common.back')} variant="secondary" size="lg" icon="arrow-back" onPress={() => setStep('cart')} disabled={placing} />
        <Button title={`${addingToBill ? tr('public.store_CartSheet.add_to_my_bill') : tr('public.store_CartSheet.place_order')} · ${price(subtotal, symbol)}`} size="lg" onPress={place} loading={placing} style={{ flex: 1 }} />
      </View>
      {!pricesIncludeTax ? <Text variant="caption" tone="subtle" align="center">{tr('public.store_CartSheet.gst_as_applicable_the_final_amount_is_on')}</Text> : null}
    </View>
  );

  return (
    <Sheet visible={visible} onClose={placing ? () => {} : onClose} dismissable={!placing} width={520}
      title={step === 'cart' ? tr('public.store_CartSheet.your_order') : tr('public.store_CartSheet.your_details')}
      subtitle={step === 'cart' ? tr('public.store_CartSheet.count_item_v_v2', { count, v: count === 1 ? '' : 's', v2: mode === 'QR' ? ` · ${tableName(tableLabel)}` : '' }) : businessName}
      footer={footer}>
      {step === 'cart' ? (
        <View style={{ gap: 4 }}>
          {lines.map((line) => (
            <View key={line.key} style={[styles.line, { borderBottomColor: colors.divider }]}>
              <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <VegMark veg={line.isVeg} size={12} />
                    <Text variant="bodyStrong" style={{ flexShrink: 1 }} numberOfLines={2}>{line.name}</Text>
                  </View>
                  <Text variant="small" tone="muted">
                    {line.variantName ? `${line.variantName} · ` : ''}{price(line.price, symbol)}
                  </Text>
                </View>
                <Stepper compact value={line.qty} onChange={(q) => onChangeQty(line.key, q)} label={line.name} />
                <Text variant="money" style={{ minWidth: 72, textAlign: 'right' }}>{price(line.price * line.qty, symbol)}</Text>
              </View>
              {noteOpen[line.key] || line.notes ? (
                <Input value={line.notes} onChangeText={(v) => onChangeNotes(line.key, v.slice(0, 200))} placeholder={tr('public.store_CartSheet.e_g_less_spicy_no_onion')}
                  maxLength={200} accessibilityLabel={tr('public.store_CartSheet.note_for_name', { name: line.name })} containerStyle={{ marginTop: 8 }} icon="create-outline" />
              ) : (
                <Pressable onPress={() => setNoteOpen((o) => ({ ...o, [line.key]: true }))} accessibilityRole="button"
                  accessibilityLabel={tr('public.store_CartSheet.add_a_note_for_name', { name: line.name })} style={[styles.noteBtn, Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}>
                  <Ionicons name="add-circle-outline" size={16} color={colors.primary} />
                  <Text variant="smallStrong" tone="primary">{tr('public.store_CartSheet.add_note')}</Text>
                </Pressable>
              )}
            </View>
          ))}
          <View style={[styles.totals, { backgroundColor: colors.surfaceSunken, borderRadius: radius.md }]}>
            <View style={styles.totalRow}>
              <Text variant="bodyStrong">{tr('public.store_CartSheet.item_total')}</Text>
              <Text variant="money">{price(subtotal, symbol)}</Text>
            </View>
            <Text variant="small" tone="muted">{taxNote}</Text>
          </View>
          <Pressable onPress={onClear} accessibilityRole="button" style={[styles.clear, Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}>
            <Ionicons name="trash-outline" size={16} color={colors.textMuted} />
            <Text variant="smallStrong" tone="muted">{tr('public.store_CartSheet.clear_cart')}</Text>
          </Pressable>
        </View>
      ) : (
        <View style={{ gap: 14 }}>
          {mode === 'QR' ? (
            <View style={[styles.tableBox, { backgroundColor: colors.primarySoft, borderRadius: radius.md }]}>
              <Ionicons name="restaurant-outline" size={20} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text variant="bodyStrong" color={colors.primarySoftText}>{tr('public.store_CartSheet.dine_in')} {tableName(tableLabel)}</Text>
                <Text variant="small" color={colors.primarySoftText}>
                  {addingToBill && existingBill ? tr('public.store_CartSheet.this_will_be_added_to_your_bill_code', { code: existingBill.code }) : tr('public.store_CartSheet.we_ll_bring_your_order_to_your_table')}
                </Text>
              </View>
            </View>
          ) : (
            <View style={{ gap: 6 }}>
              <Text variant="smallStrong" tone="muted">{tr('public.store_CartSheet.how_would_you_like_it')}</Text>
              <Segmented value={orderType} onChange={setOrderType}
                options={[{ value: 'TAKEAWAY', label: tr('common.takeaway'), icon: 'bag-handle-outline' }, { value: 'DELIVERY', label: tr('common.delivery'), icon: 'bicycle-outline' }]} />
            </View>
          )}
          <Input label={tr('public.store_CartSheet.your_name')} required value={name} onChangeText={(v) => { setName(v); setErrors((e) => ({ ...e, name: undefined })); }}
            error={errors.name} autoComplete="name" textContentType="name" maxLength={80} returnKeyType="next"
            onSubmitEditing={() => phoneRef.current?.focus()} icon="person-outline" />
          <Input ref={phoneRef} label={tr('common.mobile_number')} required value={phone} prefix="+91"
            onChangeText={(v) => { setPhone(v.replace(/[^\d+\s-]/g, '')); setErrors((e) => ({ ...e, phone: undefined })); }}
            onBlur={() => { if (phone.trim() && !normaliseIndianMobile(phone)) setErrors((e) => ({ ...e, phone: 'Enter a valid 10-digit Indian mobile number.' })); }}
            error={errors.phone}
            hint={mode !== 'QR'
              ? tr('public.store_CartSheet.the_shop_may_call_you_about_this_order')
              : existingBill && !addingToBill
                ? tr('public.store_CartSheet.a_different_number_starts_a_separate_bill', { code: existingBill.code })
                : tr('public.store_CartSheet.keeps_your_bill_separate_from_others_at')}
            keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber"
            maxLength={16} placeholder="98765 43210" />
          {mode === 'ONLINE' && orderType === 'DELIVERY' ? (
            <Input label={tr('public.store_CartSheet.delivery_address')} required value={address} onChangeText={(v) => { setAddress(v); setErrors((e) => ({ ...e, address: undefined })); }}
              error={errors.address} multiline numberOfLines={3} maxLength={500} autoComplete="street-address" textContentType="fullStreetAddress"
              placeholder={tr('public.store_CartSheet.house_flat_street_area_landmark_pin_code')} style={{ minHeight: 76, textAlignVertical: 'top' }} />
          ) : null}
          {mode === 'QR' && !addingToBill ? (
            <View style={{ gap: 8 }} accessibilityRole="radiogroup" accessibilityLabel={tr('public.store_CartSheet.how_will_you_pay')}>
              <Text variant="smallStrong" tone="muted">{tr('public.store_CartSheet.how_will_you_pay')}</Text>
              {payments.map((p) => {
                const selected = pickPayment(payments, payment) === p;
                const t = PAYMENT_TEXT[p];
                const single = payments.length === 1;
                return (
                  <Pressable key={p} onPress={() => setPayment(p)} accessibilityRole="radio" accessibilityState={{ checked: selected }}
                    accessibilityLabel={t.title} disabled={single}
                    style={[styles.payOption, {
                      borderRadius: radius.md, borderColor: selected ? colors.primary : colors.border,
                      backgroundColor: selected ? colors.primarySoft : colors.surface,
                    }, Platform.OS === 'web' && !single && ({ cursor: 'pointer' } as any)]}>
                    <Ionicons name={t.icon} size={22} color={selected ? colors.primary : colors.textMuted} />
                    <View style={{ flex: 1 }}>
                      <Text variant="bodyStrong" color={selected ? colors.primarySoftText : colors.text}>{t.title}</Text>
                      <Text variant="small" tone="muted">{t.body}</Text>
                    </View>
                    {!single ? (
                      <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={22} color={selected ? colors.primary : colors.borderStrong} />
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          ) : null}
          <Input label={mode === 'QR' ? tr('public.store_CartSheet.notes_for_the_kitchen') : tr('public.store_CartSheet.notes_for_the_shop')} value={notes} onChangeText={setNotes} maxLength={300}
            placeholder={mode === 'QR' ? tr('public.store_CartSheet.optional_e_g_allergies_less_spicy') : tr('public.store_CartSheet.optional_e_g_allergies_pickup_time')}
            multiline style={{ minHeight: 56, textAlignVertical: 'top' }} />
          <View style={styles.consent}>
            <Ionicons name="shield-checkmark-outline" size={16} color={colors.textSubtle} style={{ marginTop: 1 }} />
            <Text variant="small" tone="muted" style={{ flex: 1 }}>
              {tr('public.store_CartSheet.your_name_and_number_are_shared_with', { businessName })}{' '}
              <Link href="/privacy" accessibilityRole="link"><Text variant="smallStrong" tone="primary">{tr('common.privacy_policy')}</Text></Link>
            </Text>
          </View>
        </View>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  line: { paddingVertical: 14, borderBottomWidth: 1 },
  noteBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', minHeight: 32, marginTop: 4 },
  totals: { padding: 14, gap: 4, marginTop: 12 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  clear: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center', minHeight: 44, paddingHorizontal: 12, marginTop: 4 },
  tableBox: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  consent: { flexDirection: 'row', gap: 8 },
  payOption: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, minHeight: 64, borderWidth: 1.5 },
});
