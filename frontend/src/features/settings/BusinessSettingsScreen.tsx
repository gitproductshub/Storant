import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { adminApi } from '@/api/endpoints';
import { ApiError, errorMessage } from '@/api/client';
import type { BusinessSettings, BusinessType } from '@/api/types';
import { Badge, Button, EmptyState, ErrorState, Input, Loading, Text, toast } from '@/components/ui';
import { QrCode } from '@/components/QrCode';
import { useApi } from '@/hooks/useApi';
import { can, useAuth } from '@/store/auth';
import { useData } from '@/store/data';
import { syncNow } from '@/lib/sync';
import { printHtml } from '@/lib/print/printers';
import { printErrorMessage } from '@/lib/billing';
import { chargesGst, checkGstin, normalizeGstin, type GstRegistration } from '@/lib/gstin';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { SettingsFrame } from './SettingsFrame';
import { Callout, ChoiceChips, FieldRow, FormSection, Hairline, SaveBar, copyText, webAppOrigin, shareText, SettingSwitch } from './components';
import { fieldErrorsFrom, INVOICE_PREFIX_PATTERN, validateEmail, validateFssai, validatePhone, validateUpi } from './validation';
import { buildQrPosterHtml, upiPayUrl } from './poster';
import { brand } from '@/config/brand';
import { t as tr } from '@/i18n';

interface Form {
  business_name: string;
  business_type: BusinessType;
  address: string;
  phone: string;
  email: string;
  gstin: string;
  gst_registration: GstRegistration;
  fssai: string;
  prices_include_tax: boolean;
  default_tax_rate: number;
  invoice_prefix: string;
  receipt_footer: string;
  upi_id: string;
  loyalty_enabled: boolean;
  loyalty_points_per_100: string;
  loyalty_point_value: string;
  store_enabled: boolean;
  qr_ordering_enabled: boolean;
  low_stock_default: string;
}

type FieldKey = keyof Form;

const BUSINESS_TYPES: { value: BusinessType; label: string }[] = [
  { value: 'restaurant', get label() { return tr('common.restaurant'); } },
  { value: 'cafe', get label() { return tr('common.caf'); } },
  { value: 'cloud_kitchen', get label() { return tr('common.cloud_kitchen'); } },
  { value: 'retail', get label() { return tr('common.retail_shop'); } },
];

const GST_RATES = [0, 5, 12, 18, 28];

function toForm(s: BusinessSettings): Form {
  return {
    business_name: s.business_name ?? '',
    business_type: s.business_type,
    address: s.address ?? '',
    phone: s.phone ?? '',
    email: s.email ?? '',
    gstin: s.gstin ?? '',
    gst_registration: s.gst_registration ?? 'regular',
    fssai: s.fssai ?? '',
    prices_include_tax: !!s.prices_include_tax,
    default_tax_rate: Number(s.default_tax_rate ?? 0),
    invoice_prefix: s.invoice_prefix ?? '',
    receipt_footer: s.receipt_footer ?? '',
    upi_id: s.upi_id ?? '',
    loyalty_enabled: !!s.loyalty_enabled,
    loyalty_points_per_100: String(s.loyalty_points_per_100 ?? 0),
    loyalty_point_value: String(s.loyalty_point_value ?? 0),
    store_enabled: !!s.store_enabled,
    qr_ordering_enabled: !!s.qr_ordering_enabled,
    low_stock_default: String(s.low_stock_default ?? 0),
  };
}

const toNum = (v: string) => (v.trim() === '' ? NaN : Number(v.replace(',', '.')));

function toPayload(f: Form): Partial<BusinessSettings> {
  return {
    business_name: f.business_name.trim(),
    business_type: f.business_type,
    address: f.address.trim(),
    phone: f.phone.trim(),
    // Pydantic EmailStr rejects "", so an empty email is sent as null.
    email: f.email.trim() || null,
    gstin: normalizeGstin(f.gstin),
    gst_registration: f.gst_registration,
    fssai: f.fssai.trim(),
    prices_include_tax: f.prices_include_tax,
    default_tax_rate: f.default_tax_rate,
    invoice_prefix: f.invoice_prefix.trim().toUpperCase(),
    receipt_footer: f.receipt_footer.trim(),
    upi_id: f.upi_id.trim(),
    loyalty_enabled: f.loyalty_enabled,
    loyalty_points_per_100: Math.round(toNum(f.loyalty_points_per_100)),
    loyalty_point_value: toNum(f.loyalty_point_value),
    store_enabled: f.store_enabled,
    qr_ordering_enabled: f.qr_ordering_enabled,
    low_stock_default: Math.round(toNum(f.low_stock_default)),
  };
}

const GST_REGISTRATIONS: { value: GstRegistration; label: string }[] = [
  { value: 'regular', get label() { return tr('settings.BusinessSettingsScreen.regular_gst'); } },
  { value: 'composition', get label() { return tr('settings.BusinessSettingsScreen.composition'); } },
  { value: 'unregistered', get label() { return tr('settings.BusinessSettingsScreen.not_registered'); } },
];

const NEEDS_GSTIN = 'Enter your GSTIN to bill as a GST-registered business, or choose “Not registered”';

/** GSTIN rules (mirror the server): a typed GSTIN must be valid; regular/composition need one once either field is changed. */
function gstinError(f: Form, initial: Form | null): string | undefined {
  const check = checkGstin(f.gstin);
  if (check.gstin && !check.ok) return check.error;
  const changed = !initial || normalizeGstin(initial.gstin) !== check.gstin || initial.gst_registration !== f.gst_registration;
  if (!check.gstin && f.gst_registration !== 'unregistered' && changed) return NEEDS_GSTIN;
  return undefined;
}

function validate(f: Form, initial: Form | null): Partial<Record<FieldKey, string>> {
  const e: Partial<Record<FieldKey, string>> = {};
  if (!f.business_name.trim()) e.business_name = tr('settings.BusinessSettingsScreen.business_name_is_required');
  else if (f.business_name.trim().length > 100) e.business_name = tr('settings.BusinessSettingsScreen.use_100_characters_or_fewer');
  if (f.address.length > 300) e.address = tr('settings.BusinessSettingsScreen.use_300_characters_or_fewer');
  const phone = validatePhone(f.phone);
  if (phone) e.phone = phone;
  const email = validateEmail(f.email);
  if (email) e.email = email;
  const gstin = gstinError(f, initial);
  if (gstin) e.gstin = gstin;
  const fssai = validateFssai(f.fssai);
  if (fssai) e.fssai = fssai;
  if (!f.invoice_prefix.trim()) e.invoice_prefix = tr('settings.BusinessSettingsScreen.invoice_prefix_is_required');
  else if (!INVOICE_PREFIX_PATTERN.test(f.invoice_prefix.trim())) e.invoice_prefix = tr('settings.BusinessSettingsScreen.use_1_to_10_letters_numbers_or_dashes');
  if (f.receipt_footer.length > 300) e.receipt_footer = tr('settings.BusinessSettingsScreen.use_300_characters_or_fewer');
  const upi = validateUpi(f.upi_id);
  if (upi) e.upi_id = upi;
  const pp = toNum(f.loyalty_points_per_100);
  if (!Number.isFinite(pp) || pp < 0 || pp > 100 || !Number.isInteger(pp)) e.loyalty_points_per_100 = tr('settings.BusinessSettingsScreen.use_a_whole_number_from_0_to_100');
  const pv = toNum(f.loyalty_point_value);
  if (!Number.isFinite(pv) || pv < 0 || pv > 100) e.loyalty_point_value = tr('settings.BusinessSettingsScreen.use_a_value_from_0_to_100');
  const ls = toNum(f.low_stock_default);
  if (!Number.isFinite(ls) || ls < 0 || ls > 100000 || !Number.isInteger(ls)) e.low_stock_default = tr('settings.BusinessSettingsScreen.use_a_whole_number_from_0_to_100000');
  return e;
}

const SECTION_KEYS = ['profile', 'tax', 'payments', 'loyalty', 'online', 'inventory'] as const;
type SectionKey = (typeof SECTION_KEYS)[number];

export default function BusinessSettingsScreen() {
  const role = useAuth((s) => s.session?.role ?? null);
  if (!can(role, 'manage')) {
    return (
      <SettingsFrame active="business" title={tr('common.business')}>
        <EmptyState icon="lock-closed-outline" title={tr('common.managers_only')} message={tr('settings.BusinessSettingsScreen.ask_the_owner_or_a_manager_to_change')} />
      </SettingsFrame>
    );
  }
  return <BusinessSettingsForm />;
}

function BusinessSettingsForm() {
  const { colors } = useTheme();
  const { isPhone } = useLayout();
  const tenantId = useAuth((s) => s.session?.tenantId ?? '');
  const params = useLocalSearchParams<{ section?: string }>();
  const { data, error, loading, reload, setData } = useApi(() => adminApi.settings(), [], { refetchOnFocus: false });

  const [initial, setInitial] = useState<Form | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [touched, setTouched] = useState<Partial<Record<FieldKey, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [saving, setSaving] = useState(false);
  const [printing, setPrinting] = useState(false);

  const scrollRef = useRef<ScrollView>(null);
  const bodyOffset = useRef(0);
  const sectionY = useRef<Partial<Record<SectionKey, number>>>({});
  const scrolledFor = useRef<string | null>(null);

  useEffect(() => {
    if (data && !initial) {
      const f = toForm(data);
      setInitial(f);
      setForm(f);
    }
  }, [data, initial]);

  const dirty = useMemo(
    () => !!form && !!initial && JSON.stringify(toPayload(form)) !== JSON.stringify(toPayload(initial)),
    [form, initial],
  );
  const errors = useMemo(() => (form ? validate(form, initial) : {}), [form, initial]);

  // Browsers: warn before closing the tab with unsaved changes.
  useEffect(() => {
    if (Platform.OS !== 'web' || !dirty || typeof window === 'undefined') return undefined;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  // Deep links like /settings/business?section=payments jump to that section once the form has laid out.
  const scrollToSection = (key: string | undefined, force = false) => {
    if (!key || (!force && scrolledFor.current === key)) return;
    scrolledFor.current = key;
    const run = () => {
      if (Platform.OS === 'web' && typeof document !== 'undefined') {
        document.getElementById(`business-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      const y = sectionY.current[key as SectionKey];
      if (y !== undefined) scrollRef.current?.scrollTo({ y: Math.max(0, bodyOffset.current + y - 12), animated: true });
    };
    setTimeout(run, 250);
    setTimeout(run, 700); // again once fonts/images have settled the layout
  };
  const onSectionLayout = (key: SectionKey) => (y: number) => {
    sectionY.current[key] = y;
  };
  const loaded = !!form;
  useEffect(() => {
    if (loaded && params.section) scrollToSection(params.section);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, params.section]);

  if (loading && !form) {
    // scrollRef is passed from the first render: react-native-web's ScrollView only reports its node to the ref it mounted with.
    return <SettingsFrame active="business" title={tr('common.business')} scrollRef={scrollRef}><Loading label={tr('settings.BusinessSettingsScreen.loading_business_settings')} /></SettingsFrame>;
  }
  if (!form || !initial) {
    return <SettingsFrame active="business" title={tr('common.business')} scrollRef={scrollRef}><ErrorState message={error ?? tr('settings.BusinessSettingsScreen.could_not_load_settings')} onRetry={reload} /></SettingsFrame>;
  }

  const set = <K extends FieldKey>(key: K, value: Form[K]) => {
    setForm((f) => (f ? { ...f, [key]: value } : f));
    if (serverErrors[key]) setServerErrors((s) => ({ ...s, [key]: undefined }));
  };
  const touch = (key: FieldKey) => () => setTouched((t) => ({ ...t, [key]: true }));
  const err = (key: FieldKey): string | undefined => serverErrors[key] ?? ((touched[key] || submitted) ? errors[key] : undefined);
  // A full 15-character GSTIN is checked while typing; a shorter one once the field is left.
  const gstinErr = serverErrors.gstin ?? ((touched.gstin || submitted || normalizeGstin(form.gstin).length >= 15) ? errors.gstin : undefined);
  const hasErrors = Object.keys(errors).length > 0;

  const save = async () => {
    setSubmitted(true);
    if (hasErrors) {
      toast.error(tr('settings.BusinessSettingsScreen.fix_the_highlighted_fields_before_saving'));
      const first = SECTION_KEYS.find((k) => sectionHasError(k, errors));
      if (first) {
        scrollToSection(first, true);
      }
      return;
    }
    setSaving(true);
    try {
      const payload = toPayload(form);
      // Only send the GST fields when they changed: the server re-checks them whenever they are sent.
      if (payload.gstin === normalizeGstin(initial.gstin)) delete payload.gstin;
      if (payload.gst_registration === initial.gst_registration) delete payload.gst_registration;
      const saved = await adminApi.updateSettings(payload);
      useData.getState().setSettings(saved);
      const f = toForm(saved);
      setData(saved);
      setInitial(f);
      setForm(f);
      setSubmitted(false);
      setTouched({});
      toast.success(tr('settings.BusinessSettingsScreen.business_settings_saved'));
      // Store / QR switches also flip the matching sales channels on the server.
      void syncNow();
    } catch (e) {
      const fields = fieldErrorsFrom(e) as Partial<Record<FieldKey, string>>;
      // GSTIN problems come back as a plain 422 message ("This GSTIN has a typo…"): show it under the field.
      if (e instanceof ApiError && e.status === 422 && !Object.keys(fields).length && /GSTIN|GST-registered|state code/i.test(e.message)) {
        fields.gstin = e.message;
        scrollToSection('tax', true);
      }
      setServerErrors(fields);
      toast.error(Object.keys(fields).length ? tr('settings.BusinessSettingsScreen.some_fields_need_attention') : errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    setForm(initial);
    setTouched({});
    setSubmitted(false);
    setServerErrors({});
  };

  const gst = checkGstin(form.gstin);
  const charges = chargesGst(form.gst_registration, form.gstin);
  const gstinCleared = !gst.gstin && !!normalizeGstin(initial.gstin) && form.gst_registration !== 'unregistered';
  const gstChanged = gst.gstin !== normalizeGstin(initial.gstin) || form.gst_registration !== initial.gst_registration;
  const gstStatus: { tone: 'success' | 'warning' | 'neutral' | 'danger'; icon: 'receipt' | 'alert-circle' | 'document-text-outline'; title: string; body: string } =
    form.gst_registration === 'regular'
      ? charges
        ? { tone: 'success', icon: 'receipt', title: tr('settings.BusinessSettingsScreen.gst_is_charged_on_your_bills_tax_invoice'),
            body: tr('settings.BusinessSettingsScreen.bills_show_your_gstin_and_the_gst_for', { v: gst.state ? tr('settings.BusinessSettingsScreen.registered_in_state', { state: gst.state }) : '' }) }
        : { tone: gstinCleared ? 'danger' : 'warning', icon: 'alert-circle',
            title: gst.gstin ? tr('settings.BusinessSettingsScreen.no_gst_on_bills_fix_your_gstin') : tr('settings.BusinessSettingsScreen.no_gst_on_bills_add_your_gstin'),
            body: gstinCleared
              ? tr('settings.BusinessSettingsScreen.you_removed_the_gstin_a_regular_gst')
              : gst.gstin
                ? tr('settings.BusinessSettingsScreen.gst_is_only_charged_once_the_gstin_is')
                : tr('settings.BusinessSettingsScreen.gst_is_only_charged_when_a_valid_gstin_is') }
      : form.gst_registration === 'composition'
        ? { tone: 'neutral', icon: 'document-text-outline', title: tr('settings.BusinessSettingsScreen.composition_bill_of_supply_no_gst'),
            body: tr('settings.BusinessSettingsScreen.composition_dealers_don_t_collect_gst') }
        : { tone: 'neutral', icon: 'document-text-outline', title: tr('settings.BusinessSettingsScreen.not_registered_bill_of_supply_no_gst'),
            body: tr('settings.BusinessSettingsScreen.bills_don_t_add_gst_add_your_gstin_and') };
  const upiValid = !!form.upi_id.trim() && !validateUpi(form.upi_id);
  const storeUrl = `${webAppOrigin()}/store/${tenantId}`;
  const pp = toNum(form.loyalty_points_per_100);
  const pv = toNum(form.loyalty_point_value);
  const loyaltyExample = Number.isFinite(pp) && Number.isFinite(pv)
    ? `A ₹500 bill earns ${Math.floor(5 * pp)} points, worth ₹${(Math.floor(5 * pp) * pv).toFixed(2).replace(/\.00$/, '')} off a later bill.`
    : 'Enter both values to see an example.';

  const printPoster = async () => {
    setPrinting(true);
    try {
      await printHtml(buildQrPosterHtml({
        title: tr('settings.BusinessSettingsScreen.business_name_online_store', { business_name: form.business_name }),
        heading: form.business_name || tr('settings.BusinessSettingsScreen.order_online'),
        subheading: 'Scan to see the menu and order',
        url: storeUrl,
        footer: tr('settings.BusinessSettingsScreen.powered_by_brand', { brand: brand.name }),
      }));
    } catch (e) {
      toast.error(printErrorMessage(e));
    } finally {
      setPrinting(false);
    }
  };

  return (
    <SettingsFrame
      active="business"
      title={tr('common.business')}
      subtitle={tr('settings.BusinessSettingsScreen.shown_on_bills_your_online_store_and_gst')}
      dirty={dirty}
      scrollRef={scrollRef}
      onBodyOffset={(y) => { bodyOffset.current = y; }}
      footer={<SaveBar visible={dirty} saving={saving} onSave={save} onDiscard={discard} />}
    >
      {submitted && hasErrors ? (
        <Callout tone="danger" title={tr('settings.BusinessSettingsScreen.some_details_need_fixing')}>
          {tr('settings.BusinessSettingsScreen.length_field_v_below_v2_a_problem_they', { length: Object.keys(errors).length, v: Object.keys(errors).length === 1 ? '' : 's', v2: Object.keys(errors).length === 1 ? 'has' : 'have' })}
        </Callout>
      ) : null}

      <FormSection title={tr('settings.BusinessSettingsScreen.profile')} description={tr('settings.BusinessSettingsScreen.your_shop_s_name_and_contact_details')} onLayout={onSectionLayout('profile')} nativeID="business-profile">
        <Input label={tr('common.business_name')} required value={form.business_name} onChangeText={(v) => set('business_name', v)} onBlur={touch('business_name')}
          error={err('business_name')} maxLength={100} placeholder={tr('settings.BusinessSettingsScreen.e_g_sharma_tiffin_centre')} />
        <View style={{ gap: 6 }}>
          <Text variant="smallStrong" tone="muted">{tr('settings.BusinessSettingsScreen.business_type')}</Text>
          <ChoiceChips value={form.business_type} options={BUSINESS_TYPES} onChange={(v) => set('business_type', v)} accessibilityLabel={tr('settings.BusinessSettingsScreen.business_type')} />
          <Text variant="small" tone="subtle">{tr('settings.BusinessSettingsScreen.retail_shops_hide_tables_and_the_kitchen')}</Text>
        </View>
        <Input label={tr('settings.BusinessSettingsScreen.address')} value={form.address} onChangeText={(v) => set('address', v)} onBlur={touch('address')} error={err('address')}
          multiline numberOfLines={2} maxLength={300} placeholder={tr('settings.BusinessSettingsScreen.shop_no_street_area_city_pin')} style={{ minHeight: 64, textAlignVertical: 'top' }} />
        <FieldRow>
          <Input label={tr('common.phone')} value={form.phone} onChangeText={(v) => set('phone', v)} onBlur={touch('phone')} error={err('phone')}
            keyboardType="phone-pad" maxLength={20} placeholder="98765 43210" icon="call-outline" />
          <Input label={tr('common.email')} value={form.email} onChangeText={(v) => set('email', v)} onBlur={touch('email')} error={err('email')}
            keyboardType="email-address" autoCapitalize="none" autoCorrect={false} placeholder="hello@yourshop.in" icon="mail-outline" />
        </FieldRow>
      </FormSection>

      <FormSection title={tr('settings.BusinessSettingsScreen.gst_invoices')} description={tr('settings.BusinessSettingsScreen.gst_is_added_to_bills_only_when_you_have')} onLayout={onSectionLayout('tax')} nativeID="business-tax">
        <View style={{ gap: 6 }}>
          <Text variant="smallStrong" tone="muted">{tr('settings.BusinessSettingsScreen.gst_registration')}</Text>
          <ChoiceChips value={form.gst_registration} options={GST_REGISTRATIONS} onChange={(v) => set('gst_registration', v)} accessibilityLabel={tr('settings.BusinessSettingsScreen.gst_registration')} />
        </View>
        <FieldRow>
          <Input label={tr('settings.BusinessSettingsScreen.gstin')} required={form.gst_registration !== 'unregistered'} value={form.gstin}
            onChangeText={(v) => set('gstin', v.toUpperCase().replace(/[^0-9A-Z]/g, ''))} onBlur={touch('gstin')}
            error={gstinErr}
            hint={gst.ok ? tr('settings.BusinessSettingsScreen.valid_gstin_state', { state: gst.state }) : gst.gstin ? tr('settings.BusinessSettingsScreen.length_15_characters', { length: gst.gstin.length }) : tr('settings.BusinessSettingsScreen.15_characters_from_your_gst_certificate')}
            autoCapitalize="characters" autoCorrect={false} maxLength={15} placeholder={tr('settings.BusinessSettingsScreen.29abcde1234f1zw')}
            icon={gst.ok ? 'checkmark-circle' : 'document-text-outline'} />
          <Input label={tr('settings.BusinessSettingsScreen.fssai_licence_no')} value={form.fssai} onChangeText={(v) => set('fssai', v.replace(/\s/g, ''))} onBlur={touch('fssai')}
            error={err('fssai')} hint={tr('settings.BusinessSettingsScreen.14_digits_required_on_bills_for_food')} keyboardType="number-pad" maxLength={14} placeholder="12345678901234" />
        </FieldRow>
        <Callout tone={gstStatus.tone} icon={gstStatus.icon} title={`${gstStatus.title}${dirty && gstChanged && !errors.gstin ? tr('settings.BusinessSettingsScreen.after_you_save') : ''}`}
          action={gstinCleared && form.gst_registration === 'regular'
            ? <Button title={tr('settings.BusinessSettingsScreen.choose_not_registered')} size="sm" variant="secondary" onPress={() => set('gst_registration', 'unregistered')} />
            : <Button title={tr('settings.BusinessSettingsScreen.gst_rates_tax_classes')} size="sm" variant="ghost" iconRight="arrow-forward" onPress={() => router.navigate('/settings/taxes' as Href)} />}>
          {gstStatus.body}
        </Callout>
        <Hairline />
        <SettingSwitch title={tr('settings.BusinessSettingsScreen.menu_prices_include_gst')} value={form.prices_include_tax} onValueChange={(v) => set('prices_include_tax', v)}
          subtitle={form.prices_include_tax
            ? tr('settings.BusinessSettingsScreen.a_100_item_costs_the_customer_100_gst_is')
            : tr('settings.BusinessSettingsScreen.a_100_item_at_v_gst_costs_the_customer_v2', { v: form.default_tax_rate || 5, v2: 100 + (form.default_tax_rate || 5) })} />
        <View style={{ gap: 6 }}>
          <Text variant="smallStrong" tone="muted">{tr('settings.BusinessSettingsScreen.default_gst_rate')}</Text>
          <ChoiceChips
            value={form.default_tax_rate}
            options={[...new Set([...GST_RATES, form.default_tax_rate])].sort((a, b) => a - b).map((r) => ({ value: r, label: `${r}%` }))}
            onChange={(v) => set('default_tax_rate', v)}
            accessibilityLabel={tr('settings.BusinessSettingsScreen.default_gst_rate')}
          />
          <Text variant="small" tone="subtle">{tr('settings.BusinessSettingsScreen.used_for_items_that_don_t_have_their_own')}</Text>
        </View>
        <Hairline />
        <FieldRow>
          <Input label={tr('settings.BusinessSettingsScreen.invoice_prefix')} required value={form.invoice_prefix} onChangeText={(v) => set('invoice_prefix', v.toUpperCase().replace(/\s/g, ''))}
            onBlur={touch('invoice_prefix')} error={err('invoice_prefix')} hint={tr('settings.BusinessSettingsScreen.printed_before_each_bill_number_letters')}
            autoCapitalize="characters" maxLength={10} placeholder="INV" />
          <View />
        </FieldRow>
        <Input label={tr('settings.BusinessSettingsScreen.bill_footer')} value={form.receipt_footer} onChangeText={(v) => set('receipt_footer', v)} onBlur={touch('receipt_footer')}
          error={err('receipt_footer')} hint={tr('settings.BusinessSettingsScreen.length_300_printed_at_the_bottom_of_every', { length: form.receipt_footer.length })} multiline maxLength={300}
          placeholder={tr('settings.BusinessSettingsScreen.e_g_free_home_delivery_within_3_km_call')} style={{ minHeight: 64, textAlignVertical: 'top' }} />
      </FormSection>

      <FormSection title={tr('common.payments')} description={tr('settings.BusinessSettingsScreen.your_upi_id_is_printed_as_a_qr_code_on')} onLayout={onSectionLayout('payments')} nativeID="business-payments">
        <View style={{ flexDirection: isPhone ? 'column' : 'row', gap: 16, alignItems: isPhone ? 'stretch' : 'flex-start' }}>
          <View style={{ flex: 1, gap: 12 }}>
            <Input label={tr('settings.BusinessSettingsScreen.upi_id')} value={form.upi_id} onChangeText={(v) => set('upi_id', v.trim())} onBlur={touch('upi_id')} error={err('upi_id')}
              hint={tr('settings.BusinessSettingsScreen.use_the_upi_id_of_your_business_bank')} autoCapitalize="none" autoCorrect={false} keyboardType="email-address"
              placeholder="yourshop@okaxis" icon="qr-code-outline" />
            {upiValid ? (
              <Text variant="small" tone="muted">{tr('settings.BusinessSettingsScreen.scan_the_preview_with_any_upi_app_to')} {form.business_name || tr('settings.BusinessSettingsScreen.your_shop')}{tr('settings.BusinessSettingsScreen.don_t_complete_the_payment')}</Text>
            ) : null}
          </View>
          <View style={{ alignItems: 'center', gap: 6, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt, minWidth: 180 }}>
            {upiValid ? (
              <>
                <View style={{ borderRadius: 8, overflow: 'hidden' }}>
                  <QrCode value={upiPayUrl(form.upi_id, form.business_name)} size={140} margin={3} />
                </View>
                <Text variant="caption" tone="muted">{tr('settings.BusinessSettingsScreen.preview')} {form.upi_id}</Text>
              </>
            ) : (
              <View style={{ width: 152, height: 152, alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                <Text variant="small" tone="subtle" align="center">{form.upi_id ? tr('settings.BusinessSettingsScreen.fix_the_upi_id_to_see_the_qr') : tr('settings.BusinessSettingsScreen.qr_preview_appears_here')}</Text>
              </View>
            )}
          </View>
        </View>
      </FormSection>

      <FormSection title={tr('common.loyalty')} description={tr('settings.BusinessSettingsScreen.reward_regulars_with_points_they_can')} onLayout={onSectionLayout('loyalty')} nativeID="business-loyalty">
        <SettingSwitch title={tr('common.loyalty_points')} subtitle={form.loyalty_enabled ? tr('settings.BusinessSettingsScreen.customers_earn_points_on_every_paid_bill') : tr('settings.BusinessSettingsScreen.turned_off_no_points_are_given_or_redeemed')}
          value={form.loyalty_enabled} onValueChange={(v) => set('loyalty_enabled', v)} />
        {form.loyalty_enabled ? (
          <>
            <FieldRow>
              <Input label={tr('settings.BusinessSettingsScreen.points_per_100_spent')} value={form.loyalty_points_per_100} onChangeText={(v) => set('loyalty_points_per_100', v.replace(/[^\d]/g, ''))}
                onBlur={touch('loyalty_points_per_100')} error={err('loyalty_points_per_100')} keyboardType="number-pad" maxLength={3} placeholder="1" />
              <Input label={tr('settings.BusinessSettingsScreen.value_of_1_point')} prefix="₹" value={form.loyalty_point_value} onChangeText={(v) => set('loyalty_point_value', v.replace(/[^\d.]/g, ''))}
                onBlur={touch('loyalty_point_value')} error={err('loyalty_point_value')} keyboardType="decimal-pad" maxLength={6} placeholder="1" />
            </FieldRow>
            <Callout tone="neutral" icon="gift-outline">{loyaltyExample}</Callout>
          </>
        ) : null}
      </FormSection>

      <FormSection title={tr('settings.BusinessSettingsScreen.online_ordering')} description={tr('settings.BusinessSettingsScreen.let_customers_order_from_their_phone')} onLayout={onSectionLayout('online')} nativeID="business-online">
        <SettingSwitch title={tr('settings.BusinessSettingsScreen.own_online_store')} subtitle={tr('settings.BusinessSettingsScreen.a_menu_page_customers_can_order_from_for')}
          value={form.store_enabled} onValueChange={(v) => set('store_enabled', v)} />
        <SettingSwitch title={tr('common.qr_table_ordering')} subtitle={tr('settings.BusinessSettingsScreen.guests_scan_the_qr_on_their_table_and')}
          value={form.qr_ordering_enabled} onValueChange={(v) => set('qr_ordering_enabled', v)} />
        {form.store_enabled || initial.store_enabled ? (
          <>
            <Hairline />
            <View style={{ flexDirection: isPhone ? 'column' : 'row', gap: 16, alignItems: isPhone ? 'stretch' : 'center' }}>
              <View style={{ flex: 1, gap: 8, minWidth: 0 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text variant="smallStrong" tone="muted">{tr('settings.BusinessSettingsScreen.store_link')}</Text>
                  {initial.store_enabled ? <Badge label={tr('common.live')} tone="success" icon="radio-button-on" /> : <Badge label={tr('settings.BusinessSettingsScreen.save_to_go_live')} tone="warning" />}
                </View>
                <Text selectable variant="bodyStrong" style={{ fontFamily: Platform.select({ web: 'ui-monospace, Menlo, Consolas, monospace', ios: 'Menlo', default: 'monospace' }), fontSize: 13 }}>{storeUrl}</Text>
                <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                  <Button title={tr('settings.BusinessSettingsScreen.copy_link')} size="sm" variant="secondary" icon="copy-outline" onPress={() => copyText(storeUrl, 'Store link')} />
                  <Button title={tr('common.share')} size="sm" variant="secondary" icon="share-social-outline" onPress={() => shareText(`Order from ${form.business_name} online: ${storeUrl}`, form.business_name)} />
                  <Button title={tr('settings.BusinessSettingsScreen.print_qr_poster')} size="sm" variant="secondary" icon="print-outline" loading={printing} onPress={printPoster} />
                </View>
                {Platform.OS === 'web' && /localhost|127\.0\.0\.1/.test(storeUrl) ? (
                  <Text variant="small" tone="warning">{tr('settings.BusinessSettingsScreen.this_link_uses_localhost_so_it_only_opens')}</Text>
                ) : null}
              </View>
              <View style={{ alignItems: 'center', borderRadius: 10, overflow: 'hidden', alignSelf: 'center' }}>
                <QrCode value={storeUrl} size={136} margin={3} />
              </View>
            </View>
          </>
        ) : null}
      </FormSection>

      <FormSection title={tr('common.inventory')} description={tr('settings.BusinessSettingsScreen.items_with_stock_tracking_show_a_low')} onLayout={onSectionLayout('inventory')} nativeID="business-inventory">
        <FieldRow>
          <Input label={tr('settings.BusinessSettingsScreen.low_stock_alert_at')} value={form.low_stock_default} onChangeText={(v) => set('low_stock_default', v.replace(/[^\d]/g, ''))}
            onBlur={touch('low_stock_default')} error={err('low_stock_default')} keyboardType="number-pad" maxLength={6} hint={tr('settings.BusinessSettingsScreen.units_left_in_stock')} />
          <View />
        </FieldRow>
        <Button title={tr('settings.BusinessSettingsScreen.open_inventory')} variant="ghost" size="sm" iconRight="arrow-forward" onPress={() => router.navigate('/inventory' as Href)} style={{ alignSelf: 'flex-start' }} />
      </FormSection>
    </SettingsFrame>
  );
}

const SECTION_FIELDS: Record<SectionKey, FieldKey[]> = {
  profile: ['business_name', 'business_type', 'address', 'phone', 'email'],
  tax: ['gstin', 'gst_registration', 'fssai', 'prices_include_tax', 'default_tax_rate', 'invoice_prefix', 'receipt_footer'],
  payments: ['upi_id'],
  loyalty: ['loyalty_enabled', 'loyalty_points_per_100', 'loyalty_point_value'],
  online: ['store_enabled', 'qr_ordering_enabled'],
  inventory: ['low_stock_default'],
};

function sectionHasError(key: SectionKey, errors: Partial<Record<FieldKey, string>>): boolean {
  return SECTION_FIELDS[key].some((f) => !!errors[f]);
}
