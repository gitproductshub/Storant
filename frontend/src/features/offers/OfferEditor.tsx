/** Create / edit an offer or loyalty reward, with a live plain-language preview. */
import React, { useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { errorMessage } from '@/api/client';
import { offersApi, type Offer, type OfferBenefit, type OfferKind } from '@/api/offers';
import type { OrderType, Product } from '@/api/types';
import { Button, Chip, Input, Text, VegMark, toast } from '@/components/ui';
import { DetailPanel } from '@/features/catalog/DetailPanel';
import { confirmTop as confirm } from '@/features/catalog/dialogs';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { activeCategories, useData } from '@/store/data';
import { money } from '@/lib/format';
import { CHANNEL_UI, ORDER_TYPE_UI } from '@/lib/uiLabels';
import { ChoiceChips, FieldRow, FormSection, SettingSwitch } from '@/features/settings/components';
import { ALL_ORDER_TYPES, DAY_SHORT, emptyForm, fromOffer, previewSentence, toInput, validateForm, type FormErrors, type OfferForm } from './form';
import { t as tr } from '@/i18n';

export function OfferEditor({ offer, initialKind, loyaltyAllowed, canAnnounce, onClose, onSaved }: {
  offer: Offer | null;
  initialKind: OfferKind;
  loyaltyAllowed: boolean;
  canAnnounce: boolean;
  onClose: () => void;
  onSaved: (o: Offer) => void;
}) {
  const { colors, radius } = useTheme();
  const { isPhone } = useLayout();
  // Side panel next to the list on tablets and desktops, full screen on phones
  const products = useData((s) => s.products);
  const categories = useData((s) => s.categories);
  const channels = useData((s) => s.channels);
  const settings = useData((s) => s.settings);
  const isRetail = settings?.business_type === 'retail';

  const initial = useMemo(() => (offer ? fromOffer(offer) : emptyForm(initialKind)), [offer, initialKind]);
  const [form, setForm] = useState<OfferForm>(initial);
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [announcing, setAnnouncing] = useState(false);
  const errors: FormErrors = useMemo(() => validateForm(form), [form]);
  const shown = (k: keyof OfferForm) => (tried ? errors[k] ?? null : null);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const set = <K extends keyof OfferForm>(k: K, v: OfferForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  const productName = useMemo(() => {
    const m = new Map(products.map((p) => [p.id, p.name]));
    return (id: string) => m.get(id);
  }, [products]);
  const categoryName = useMemo(() => {
    const m = new Map(categories.map((c) => [c.id, c.name]));
    return (id: string) => m.get(id);
  }, [categories]);
  const channelName = (code: string) => channels.find((c) => c.code === code)?.name ?? CHANNEL_UI[code] ?? code;
  const sentence = previewSentence(form, { product: productName, category: categoryName, channel: channelName });

  const sellable = useMemo(() => products.filter((p) => p.is_active).sort((a, b) => a.name.localeCompare(b.name)), [products]);
  const cats = useMemo(() => activeCategories(categories), [categories]);
  const channelOptions = useMemo(() => channels.filter((c) => c.enabled || c.code === 'POS'), [channels]);
  const orderTypes: OrderType[] = isRetail ? ['RETAIL_WALKIN', 'TAKEAWAY', 'DELIVERY'] : ALL_ORDER_TYPES.filter((t) => t !== 'RETAIL_WALKIN');

  const kindOptions: { value: OfferKind; label: string }[] = [
    { value: 'bill', label: tr('offers.OfferEditor.whole_bill') },
    { value: 'items', label: tr('offers.OfferEditor.selected_items') },
    ...(loyaltyAllowed || form.kind === 'loyalty' ? [{ value: 'loyalty' as OfferKind, label: tr('offers.OfferEditor.loyalty_reward') }] : []),
  ];
  const benefitOptions: { value: OfferBenefit; label: string }[] = [
    { value: 'percent', label: tr('offers.OfferEditor.off') },
    { value: 'flat', label: tr('offers.OfferEditor.v_off', { v: settings?.currency_symbol ?? '₹' }) },
    { value: 'free_item', label: tr('offers.OfferEditor.free_item') },
  ];

  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const close = async () => {
    if (dirty && !(await confirm({ title: tr('offers.OfferEditor.discard_changes'), message: tr('offers.OfferEditor.your_changes_to_this_offer_will_be_lost'), confirmLabel: tr('common.discard'), danger: true }))) return;
    onClose();
  };

  const save = async () => {
    setTried(true);
    const first = Object.values(errors)[0];
    if (first) { toast.warning(first); return; }
    setSaving(true);
    try {
      const body = toInput(form);
      const saved = offer ? await offersApi.update(offer.id, body) : await offersApi.create(body);
      toast.success(offer ? tr('offers.OfferEditor.offer_updated') : form.kind === 'loyalty' ? tr('offers.OfferEditor.loyalty_reward_created') : tr('offers.OfferEditor.offer_created'));
      onSaved(saved);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const announce = async () => {
    if (!offer) return;
    if (dirty) { toast.warning(tr('offers.OfferEditor.save_your_changes_first_then_announce_the')); return; }
    if (!offer.is_active) { toast.warning(tr('offers.OfferEditor.switch_the_offer_on_before_announcing_it')); return; }
    const ok = await confirm({
      title: tr('offers.OfferEditor.email_this_offer_to_customers'),
      message: tr('offers.OfferEditor.name_will_be_emailed_to_every_customer', { name: offer.name }),
      confirmLabel: tr('offers.OfferEditor.send_emails'),
    });
    if (!ok) return;
    setAnnouncing(true);
    try {
      const r = await offersApi.announce(offer.id);
      if (r.queued > 0) toast.success(tr('offers.OfferEditor.emailing_queued_customer_v', { queued: r.queued, v: r.queued === 1 ? '' : 's' }));
      else toast.info(r.opted_in_customers ? tr('offers.OfferEditor.those_customers_were_already_emailed') : tr('offers.OfferEditor.no_customers_have_agreed_to_receive'));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setAnnouncing(false);
    }
  };

  const title = offer ? tr('offers.OfferEditor.edit_v', { v: offer.kind === 'loyalty' ? 'reward' : 'offer' }) : form.kind === 'loyalty' ? tr('offers.OfferEditor.new_loyalty_reward') : tr('common.new_offer');

  return (
    <DetailPanel onClose={() => void close()} title={offer ? offer.name : title} subtitle={offer ? title : tr('offers.OfferEditor.set_what_the_customer_gets_then_who_and')}
      dismissable={!saving} testID="offer-editor"
      footer={
        <View style={{ gap: 10 }}>
          <View style={[styles.preview, { backgroundColor: colors.primarySoft, borderRadius: radius.md }]} accessibilityLiveRegion="polite">
            <Ionicons name="eye-outline" size={16} color={colors.primarySoftText} style={{ marginTop: 2 }} />
            <Text variant="small" color={colors.primarySoftText} style={{ flex: 1 }} numberOfLines={isPhone ? 4 : 3}>{sentence}</Text>
          </View>
          <View style={styles.footerRow}>
            {offer && canAnnounce ? (
              <Button title={isPhone ? tr('common.email') : tr('offers.OfferEditor.announce_by_email')} icon="mail-outline" variant="ghost" onPress={() => void announce()} loading={announcing} disabled={saving} />
            ) : null}
            <View style={{ flex: 1 }} />
            <Button title={offer ? tr('common.save') : tr('offers.OfferEditor.create')} icon="checkmark" onPress={() => void save()} loading={saving}
              disabled={announcing || (!!offer && !dirty)} disabledReason={offer && !dirty ? tr('offers.OfferEditor.no_changes_yet_x') : undefined}
              style={isPhone ? { flex: 1 } : undefined} testID="offer-save" />
          </View>
        </View>
      }>
      <View style={{ gap: 20 }}>
        <FormSection stacked title={tr('offers.OfferEditor.the_offer')} description={tr('offers.OfferEditor.customers_see_the_name_on_their_bill')}>
          <ChoiceChips value={form.kind} options={kindOptions} accessibilityLabel={tr('offers.OfferEditor.offer_applies_to')}
            onChange={(k) => setForm((f) => ({ ...f, kind: k, ...(k === 'loyalty' && !f.min_visits ? { min_visits: '5' } : {}) }))} />
          <Input label={tr('common.name')} required value={form.name} onChangeText={(t) => set('name', t)} maxLength={80}
            placeholder={form.kind === 'loyalty' ? tr('offers.OfferEditor.e_g_5th_visit_reward') : tr('offers.OfferEditor.e_g_happy_hours_20_off')} error={shown('name')} />
          <Input label={tr('offers.OfferEditor.description_optional')} value={form.description} onChangeText={(t) => set('description', t)} maxLength={300}
            placeholder={tr('offers.OfferEditor.shown_to_staff_and_in_the_announcement')} error={shown('description')} />
        </FormSection>

        <FormSection stacked title={tr('offers.OfferEditor.what_the_customer_gets')}>
          <ChoiceChips value={form.benefit_type} options={benefitOptions} onChange={(b) => set('benefit_type', b)} accessibilityLabel={tr('offers.OfferEditor.benefit')} />
          {form.benefit_type === 'free_item' ? (
            <>
              <ItemPicker label={tr('offers.OfferEditor.free_item')} products={sellable} selected={form.free_product_id ? [form.free_product_id] : []} single
                onChange={(ids) => set('free_product_id', ids[0] ?? null)} error={shown('free_product_id')} currency={settings?.currency_symbol ?? '₹'} />
              <Input label={tr('offers.OfferEditor.how_many_free')} keyboardType="number-pad" value={form.free_quantity} onChangeText={(t) => set('free_quantity', t)}
                containerStyle={{ maxWidth: 200 }} error={shown('free_quantity')} />
            </>
          ) : (
            <FieldRow>
              <Input label={form.benefit_type === 'percent' ? tr('offers.OfferEditor.percent_off') : tr('offers.OfferEditor.amount_off')} required keyboardType="decimal-pad" value={form.value}
                onChangeText={(t) => set('value', t)} placeholder={form.benefit_type === 'percent' ? tr('offers.OfferEditor.e_g_20') : tr('offers.OfferEditor.e_g_100')}
                prefix={form.benefit_type === 'flat' ? settings?.currency_symbol ?? '₹' : undefined}
                right={form.benefit_type === 'percent' ? <Text tone="muted" style={{ marginRight: 12 }}>%</Text> : undefined}
                error={shown('value')} hint={tr('offers.OfferEditor.taken_off_before_gst')} />
              {form.benefit_type === 'percent' ? (
                <Input label={tr('offers.OfferEditor.up_to_optional')} keyboardType="decimal-pad" value={form.max_discount} onChangeText={(t) => set('max_discount', t)}
                  prefix={settings?.currency_symbol ?? '₹'} placeholder={tr('offers.OfferEditor.no_limit')} error={shown('max_discount')} hint={tr('offers.OfferEditor.largest_discount_on_one_bill')} />
              ) : null}
            </FieldRow>
          )}
        </FormSection>

        <FormSection stacked title={tr('offers.OfferEditor.who_and_when')} description={tr('offers.OfferEditor.leave_anything_empty_to_allow_it_at_any')}>
          {form.kind === 'items' ? (
            <>
              <ItemPicker label={tr('common.items')} products={sellable} selected={form.product_ids} onChange={(ids) => set('product_ids', ids)}
                error={shown('product_ids')} currency={settings?.currency_symbol ?? '₹'} />
              {cats.length ? (
                <View style={{ gap: 6 }}>
                  <Text variant="smallStrong" tone="muted">{tr('offers.OfferEditor.or_whole_categories')}</Text>
                  <View style={styles.chips}>
                    {cats.map((c) => (
                      <Chip key={c.id} label={c.name} selected={form.category_ids.includes(c.id)} onPress={() => set('category_ids', toggle(form.category_ids, c.id))} />
                    ))}
                  </View>
                </View>
              ) : null}
            </>
          ) : null}
          {form.kind === 'loyalty' ? (
            <FieldRow>
              <Input label={tr('offers.OfferEditor.visits_needed')} required keyboardType="number-pad" value={form.min_visits} onChangeText={(t) => set('min_visits', t)}
                placeholder={tr('offers.OfferEditor.e_g_5')} error={shown('min_visits')} hint={tr('offers.OfferEditor.completed_bills_by_this_customer')} />
              <Input label={tr('offers.OfferEditor.within_the_last_days')} keyboardType="number-pad" value={form.window_days} onChangeText={(t) => set('window_days', t)}
                placeholder={tr('offers.OfferEditor.all_time')} error={shown('window_days')} />
            </FieldRow>
          ) : null}
          <Input label={tr('offers.OfferEditor.minimum_bill_optional')} keyboardType="decimal-pad" value={form.min_order} onChangeText={(t) => set('min_order', t)}
            prefix={settings?.currency_symbol ?? '₹'} placeholder={tr('offers.OfferEditor.any_amount')} error={shown('min_order')} containerStyle={{ maxWidth: 320 }} />

          <View style={{ gap: 6 }}>
            <Text variant="smallStrong" tone="muted">{tr('common.days')}</Text>
            <View style={styles.chips}>
              <Chip label={tr('offers.OfferEditor.every_day')} selected={form.days.length === 0 || form.days.length === 7} onPress={() => set('days', [])} />
              {DAY_SHORT.map((d, i) => (
                <Chip key={d} label={d} selected={form.days.length > 0 && form.days.length < 7 && form.days.includes(i)}
                  onPress={() => set('days', toggle(form.days.length === 7 ? [] : form.days, i))} />
              ))}
            </View>
          </View>
          <FieldRow>
            <Input label={tr('offers.OfferEditor.from_time')} value={form.start_time} onChangeText={(t) => set('start_time', t)} placeholder={tr('offers.OfferEditor.e_g_18_00')} maxLength={5}
              keyboardType="numbers-and-punctuation" error={shown('start_time')} />
            <Input label={tr('offers.OfferEditor.to_time')} value={form.end_time} onChangeText={(t) => set('end_time', t)} placeholder={tr('offers.OfferEditor.e_g_22_00')} maxLength={5}
              keyboardType="numbers-and-punctuation" error={shown('end_time')} hint={tr('offers.OfferEditor.24_hour_22_00_to_02_00_runs_overnight')} />
          </FieldRow>
          <FieldRow>
            <Input label={tr('offers.OfferEditor.first_day')} value={form.starts_on} onChangeText={(t) => set('starts_on', t)} placeholder={tr('offers.OfferEditor.yyyy_mm_dd_today')} maxLength={10}
              keyboardType="numbers-and-punctuation" error={shown('starts_on')} />
            <Input label={tr('offers.OfferEditor.last_day')} value={form.ends_on} onChangeText={(t) => set('ends_on', t)} placeholder={tr('offers.OfferEditor.yyyy_mm_dd_no_end')} maxLength={10}
              keyboardType="numbers-and-punctuation" error={shown('ends_on')} />
          </FieldRow>
          {channelOptions.length > 1 ? (
            <View style={{ gap: 6 }}>
              <Text variant="smallStrong" tone="muted">{tr('common.sales_channels')}</Text>
              <View style={styles.chips}>
                <Chip label={tr('offers.OfferEditor.all_channels')} selected={form.channels.length === 0} onPress={() => set('channels', [])} />
                {channelOptions.map((c) => (
                  <Chip key={c.code} label={c.name || CHANNEL_UI[c.code] || c.code} selected={form.channels.includes(c.code)}
                    onPress={() => set('channels', toggle(form.channels, c.code))} />
                ))}
              </View>
            </View>
          ) : null}
          <View style={{ gap: 6 }}>
            <Text variant="smallStrong" tone="muted">{tr('offers.OfferEditor.order_types')}</Text>
            <View style={styles.chips}>
              <Chip label={tr('common.all')} selected={form.order_types.length === 0} onPress={() => set('order_types', [])} />
              {orderTypes.map((t) => (
                <Chip key={t} label={ORDER_TYPE_UI[t] ?? t} selected={form.order_types.includes(t)} onPress={() => set('order_types', toggle(form.order_types, t))} />
              ))}
            </View>
          </View>
        </FormSection>

        <FormSection stacked title={tr('offers.OfferEditor.limits')} description={tr('offers.OfferEditor.stop_the_offer_after_a_number_of_uses_per')}>
          <FieldRow>
            <Input label={tr('offers.OfferEditor.total_uses')} keyboardType="number-pad" value={form.max_total} onChangeText={(t) => set('max_total', t)} placeholder={tr('offers.OfferEditor.no_limit')} error={shown('max_total')} />
            <Input label={tr('offers.OfferEditor.uses_per_customer')} keyboardType="number-pad" value={form.max_per_customer} onChangeText={(t) => set('max_per_customer', t)} placeholder={tr('offers.OfferEditor.no_limit')} error={shown('max_per_customer')} />
            <Input label={tr('offers.OfferEditor.priority')} keyboardType="number-pad" value={form.priority} onChangeText={(t) => set('priority', t)} placeholder="0" error={shown('priority')}
              hint={tr('offers.OfferEditor.higher_shows_first')} />
          </FieldRow>
        </FormSection>

        <FormSection stacked title={tr('offers.OfferEditor.code_and_applying')}>
          <Input label={tr('offers.OfferEditor.coupon_code_optional')} value={form.code} onChangeText={(t) => set('code', t.toUpperCase().replace(/\s/g, ''))} maxLength={20}
            autoCapitalize="characters" autoCorrect={false} placeholder={tr('offers.OfferEditor.e_g_diwali20')} icon="ticket-outline" error={shown('code')}
            hint={tr('offers.OfferEditor.customers_can_quote_it_the_cashier_types')} />
          <SettingSwitch title={tr('offers.OfferEditor.apply_automatically')} subtitle={tr('offers.OfferEditor.the_pos_adds_the_best_automatic_offer')}
            value={form.auto_apply} onValueChange={(v) => set('auto_apply', v)} />
          <SettingSwitch title={tr('offers.OfferEditor.offer_is_on')} subtitle={tr('offers.OfferEditor.switch_off_to_stop_it_right_away_you_can')}
            value={form.is_active} onValueChange={(v) => set('is_active', v)} />
        </FormSection>
      </View>
    </DetailPanel>
  );
}

/** Searchable list of menu items with checkboxes (or radio buttons when `single`). */
function ItemPicker({ label, products, selected, onChange, single, error, currency }: {
  label: string; products: Product[]; selected: string[]; onChange: (ids: string[]) => void; single?: boolean; error?: string | null; currency: string;
}) {
  const { colors, radius } = useTheme();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(selected.length === 0);
  const q = query.trim().toLowerCase();
  const list = useMemo(() => (q ? products.filter((p) => p.name.toLowerCase().includes(q) || (p.sku ?? '').toLowerCase().includes(q)) : products).slice(0, 80),
    [products, q]);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const pick = (id: string) => {
    if (single) { onChange([id]); setOpen(false); return; }
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  };

  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Text variant="smallStrong" tone="muted">{label}{selected.length && !single ? tr('offers.OfferEditor.length_chosen', { length: selected.length }) : ''}</Text>
        {selected.length ? <Button title={open ? tr('common.done') : single ? tr('offers.OfferEditor.change') : tr('offers.OfferEditor.add_or_remove')} size="sm" variant="ghost" onPress={() => setOpen((o) => !o)} /> : null}
      </View>
      {selected.length ? (
        <View style={styles.chips}>
          {selected.map((id) => (
            <Chip key={id} label={byId.get(id)?.name ?? tr('offers.OfferEditor.removed_item')} icon={single ? 'gift-outline' : 'close'} selected
              onPress={single ? () => setOpen(true) : () => onChange(selected.filter((x) => x !== id))} />
          ))}
        </View>
      ) : null}
      {open ? (
        <View style={[styles.picker, { borderColor: error ? colors.danger : colors.border, borderRadius: radius.md }]}>
          <Input value={query} onChangeText={setQuery} placeholder={tr('offers.OfferEditor.search_menu_items')} icon="search" autoCorrect={false} accessibilityLabel={tr('offers.OfferEditor.search_label', { label })} />
          {products.length === 0 ? (
            <Text variant="small" tone="muted" style={{ padding: 8 }}>{tr('offers.OfferEditor.no_menu_items_yet_add_items_in_menu_items')}</Text>
          ) : list.length === 0 ? (
            <Text variant="small" tone="muted" style={{ padding: 8 }}>{tr('offers.OfferEditor.no_items_match_query', { query })}</Text>
          ) : (
            <ScrollView style={{ maxHeight: 260 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
              {list.map((p) => {
                const on = selected.includes(p.id);
                return (
                  <Pressable key={p.id} onPress={() => pick(p.id)} accessibilityRole={single ? 'radio' : 'checkbox'} accessibilityState={{ checked: on }}
                    accessibilityLabel={p.name}
                    style={({ hovered }: any) => [styles.pickRow, { borderRadius: radius.sm, backgroundColor: on ? colors.primarySoft : hovered ? colors.surfaceSunken : 'transparent' },
                      Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}>
                    <Ionicons name={single ? (on ? 'radio-button-on' : 'radio-button-off') : on ? 'checkbox' : 'square-outline'} size={20}
                      color={on ? colors.primary : colors.textSubtle} />
                    <VegMark veg={p.is_veg} size={12} />
                    <Text variant="body" numberOfLines={1} style={{ flex: 1 }}>{p.name}</Text>
                    <Text variant="small" tone="muted">{money(p.base_price, currency)}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
        </View>
      ) : null}
      {error ? <Text variant="small" tone="danger">{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  preview: { flexDirection: 'row', gap: 8, padding: 10, alignItems: 'flex-start' },
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  picker: { borderWidth: 1, padding: 8, gap: 6 },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 8, minHeight: 44 },
});
