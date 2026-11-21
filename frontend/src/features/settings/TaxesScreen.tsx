/**
 * Settings › GST & taxes. Built around "the government changed GST for my items":
 * registration type, prices incl. tax, the default class, tax classes with dated rate changes, and bulk assignment.
 * Past bills never change: each bill keeps the tax that applied when it was made.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { router, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { errorMessage, isOffline } from '@/api/client';
import { adminApi } from '@/api/endpoints';
import {
  describeComponents, formatRate, rememberTaxOverview, taxesApi, upcomingRates, type GstRegistration, type TaxClass, type TaxOverview,
} from '@/api/taxes';
import { Badge, Button, Card, EmptyState, ErrorState, Loading, Text, toast } from '@/components/ui';
import { TopDialogHost, confirmTop } from '@/features/catalog/dialogs';
import { useApi } from '@/hooks/useApi';
import { syncNow } from '@/lib/sync';
import { useData } from '@/store/data';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { SettingsFrame } from './SettingsFrame';
import { Callout, FormSection, Hairline, SettingSwitch } from './components';
import { AddClassSheet } from './taxes/AddClassSheet';
import { AssignSheet } from './taxes/AssignSheet';
import { ClassDetailSheet } from './taxes/ClassDetailSheet';
import { RatePill, formatEffective, useCanManageTaxes, useOnline } from './taxes/shared';
import { brand } from '@/config/brand';
import { t } from '@/i18n';

const REGISTRATION: { key: GstRegistration; title: string; bill: string; detail: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'regular', get title() { return t('settings.TaxesScreen.regular_gst'); }, bill: 'Tax invoice', icon: 'receipt-outline',
    get detail() { return t('settings.TaxesScreen.bills_are_tax_invoices_with_your_gstin'); } },
  { key: 'composition', get title() { return t('settings.TaxesScreen.composition_scheme'); }, bill: 'Bill of supply', icon: 'document-text-outline',
    get detail() { return t('settings.TaxesScreen.bills_are_a_bill_of_supply_with_no_gst'); } },
  { key: 'unregistered', get title() { return t('settings.TaxesScreen.not_registered'); }, bill: 'Bill without GST', icon: 'remove-circle-outline',
    get detail() { return t('settings.TaxesScreen.for_businesses_below_the_gst_turnover'); } },
];

export default function TaxesScreen() {
  const { colors } = useTheme();
  const { width, isPhone } = useLayout();
  const canEdit = useCanManageTaxes();
  const online = useOnline();
  const settings = useData((s) => s.settings);
  const { data, setData, error, loading, refreshing, reload } = useApi(() => taxesApi.overview(), []);
  const [busy, setBusy] = useState<null | 'registration' | 'prices' | 'default'>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [assigning, setAssigning] = useState<{ classId?: string | null } | null>(null);
  const [gridWidth, setGridWidth] = useState(0);

  const editable = canEdit && online;
  const classes = data?.classes ?? [];
  const active = useMemo(() => classes.filter((c) => c.is_active), [classes]);
  const defaultClass = classes.find((c) => c.id === data?.default_tax_class_id) ?? null;
  const detail = classes.find((c) => c.id === detailId) ?? null;
  const upcoming = useMemo(
    () => classes.flatMap((c) => upcomingRates(c).map((r) => ({ c, r }))).sort((a, b) => a.r.effective_from.localeCompare(b.r.effective_from)),
    [classes],
  );
  // Keep the product editor's copy of the classes in step with this screen.
  useEffect(() => { if (data) rememberTaxOverview(data); }, [data]);

  const frame = (children: React.ReactNode) => (
    <SettingsFrame active="taxes" title={t('common.gst_taxes')} subtitle={t('settings.TaxesScreen.how_gst_is_charged_on_your_bills_and_what')}
      refreshing={refreshing} onRefresh={reload} maxWidth={1040}
      actions={data && canEdit ? <Button title={isPhone ? undefined : t('settings.TaxesScreen.add_tax_class')} icon="add" onPress={() => setAdding(true)} disabled={!online} accessibilityLabel={t('settings.TaxesScreen.add_tax_class')} /> : undefined}>
      {children}
    </SettingsFrame>
  );

  if (loading && !data) return frame(<Loading label={t('settings.TaxesScreen.loading_tax_settings')} />);
  if (!data) {
    return frame(<ErrorState message={error ?? t('settings.TaxesScreen.could_not_load_tax_settings')} onRetry={reload} />);
  }

  /** Settings changes go through PUT /settings and are mirrored into the tax overview + offline cache. */
  const saveSetting = async (key: 'registration' | 'prices' | 'default', body: Record<string, unknown>, patch: Partial<TaxOverview>, okMessage: string) => {
    setBusy(key);
    try {
      const saved = await adminApi.updateSettings(body);
      useData.getState().setSettings(saved);
      setData((d) => (d ? { ...d, ...patch, classes: patch.default_tax_class_id !== undefined ? d.classes.map((c) => ({ ...c, is_default: c.id === patch.default_tax_class_id })) : d.classes } : d));
      toast.success(okMessage);
    } catch (e) {
      toast.error(isOffline(e) ? t('settings.TaxesScreen.you_re_offline_try_again_when_you_re') : errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const changeRegistration = async (next: GstRegistration) => {
    if (next === data.registration || !editable) return;
    const info = REGISTRATION.find((r) => r.key === next)!;
    const ok = await confirmTop({
      title: t('settings.TaxesScreen.switch_to_title', { title: info.title }),
      message: next === 'regular'
        ? t('settings.TaxesScreen.new_bills_will_be_tax_invoices_with_gst')
        : t('settings.TaxesScreen.new_bills_will_be_a_bill_with_no_gst', { bill: info.bill }),
      confirmLabel: t('settings.TaxesScreen.switch'),
    });
    if (!ok) return;
    await saveSetting('registration', { gst_registration: next }, { registration: next }, `Bills are now: ${info.bill}`);
  };

  const exampleRate = defaultClass?.current_rate ?? 5;
  const inclusiveTax = 100 - 100 / (1 + exampleRate / 100);
  const pricesSubtitle = data.prices_include_tax
    ? `On. A ₹100 item costs the customer ₹100: ₹${(100 - inclusiveTax).toFixed(2)} price + ₹${inclusiveTax.toFixed(2)} GST at ${formatRate(exampleRate)}%.`
    : `Off. A ₹100 item at ${formatRate(exampleRate)}% GST costs the customer ₹${(100 + exampleRate).toFixed(2).replace(/\.00$/, '')}: GST is added on top.`;

  const chargesGst = data.registration === 'regular';
  const missingGstin = chargesGst && settings && !settings.gstin;
  const twoCol = width >= 900;

  return (
    <>
      {frame(
        <>
          {!canEdit ? (
            <Callout tone="neutral" icon="lock-closed-outline" title={t('settings.TaxesScreen.view_only')}>
              {t('settings.TaxesScreen.only_the_owner_or_a_manager_with_settings')}
            </Callout>
          ) : !online ? (
            <Callout tone="warning" icon="cloud-offline-outline" title={t('common.you_re_offline')}>
              {t('settings.TaxesScreen.tax_settings_can_be_viewed_but_not')}
            </Callout>
          ) : null}

          <Callout tone="info" icon="shield-checkmark-outline" title={t('settings.TaxesScreen.past_bills_never_change')}>
            {t('settings.TaxesScreen.each_bill_keeps_the_gst_rate_that_applied')}
          </Callout>

          {upcoming.length ? (
            <Callout tone="warning" icon="time-outline" title={t('settings.TaxesScreen.length_upcoming_rate_change_v', { length: upcoming.length, v: upcoming.length === 1 ? '' : 's' })}>
              <View style={{ gap: 2 }}>
                {upcoming.slice(0, 5).map(({ c, r }) => (
                  <Text key={r.id} variant="small">
                    {formatEffective(r.effective_from)}: {c.name} {c.current_rate !== null ? `${formatRate(c.current_rate)}% → ` : ''}{formatRate(r.total_rate)}%
                  </Text>
                ))}
              </View>
            </Callout>
          ) : null}

          {/* Registration */}
          <FormSection title={t('settings.TaxesScreen.gst_registration')} description={t('settings.TaxesScreen.decides_what_kind_of_bill_you_print_and')}>
            <View style={{ flexDirection: twoCol ? 'row' : 'column', gap: 10 }}>
              {REGISTRATION.map((r) => {
                const selected = data.registration === r.key;
                return (
                  <Pressable key={r.key} onPress={() => changeRegistration(r.key)} disabled={!editable || busy !== null}
                    accessibilityRole="radio" accessibilityState={{ checked: selected, disabled: !editable }} accessibilityLabel={`${r.title}. ${r.detail}`}
                    style={({ hovered }: any) => [{
                      flex: twoCol ? 1 : undefined, gap: 6, padding: 14, borderRadius: 12, borderWidth: 1.5,
                      borderColor: selected ? colors.primary : colors.border,
                      backgroundColor: selected ? colors.primarySoft : hovered && editable ? colors.surfaceSunken : colors.surface,
                      opacity: !selected && !editable ? 0.7 : 1,
                    }, Platform.OS === 'web' && editable && ({ cursor: 'pointer' } as any)]}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={18} color={selected ? colors.primary : colors.textSubtle} />
                      <Text variant="bodyStrong" style={{ flex: 1 }} color={selected ? colors.primarySoftText : colors.text}>{r.title}</Text>
                    </View>
                    <Badge label={r.bill} tone={selected ? 'primary' : 'neutral'} icon={r.icon} />
                    <Text variant="small" tone="muted">{r.detail}</Text>
                  </Pressable>
                );
              })}
            </View>
            {busy === 'registration' ? <Text variant="small" tone="muted">{t('settings.TaxesScreen.saving')}</Text> : null}
            {missingGstin ? (
              <Callout tone="warning" title={t('settings.TaxesScreen.gstin_missing')}
                action={<Button title={t('settings.TaxesScreen.add_gstin')} size="sm" variant="secondary" icon="arrow-forward" onPress={() => router.navigate('/settings/business?section=tax' as Href)} />}>
                {t('settings.TaxesScreen.a_tax_invoice_must_show_your_gstin_add_it')}
              </Callout>
            ) : null}
            {!chargesGst ? (
              <Callout tone="neutral">{t('settings.TaxesScreen.your_tax_classes_are_kept_but_no_gst_is')}</Callout>
            ) : null}
          </FormSection>

          {/* Prices & default */}
          <FormSection title={t('settings.TaxesScreen.prices_default_rate')} description={t('settings.TaxesScreen.how_menu_prices_relate_to_gst_and_the')}>
            <SettingSwitch title={t('settings.TaxesScreen.menu_prices_include_gst')} value={data.prices_include_tax} disabled={!editable || busy !== null}
              onValueChange={(v) => saveSetting('prices', { prices_include_tax: v }, { prices_include_tax: v }, v ? 'Prices now include GST' : 'GST is now added on top of prices')}
              subtitle={pricesSubtitle} />
            <Hairline />
            <View style={{ gap: 8 }}>
              <Text variant="smallStrong" tone="muted">{t('settings.TaxesScreen.default_tax_class')}</Text>
              {editable ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} accessibilityRole="radiogroup">
                  {active.map((c) => {
                    const selected = c.id === data.default_tax_class_id;
                    return (
                      <Pressable key={c.id} disabled={busy !== null} accessibilityRole="radio" accessibilityState={{ checked: selected }}
                        onPress={() => !selected && saveSetting('default', { default_tax_class_id: c.id }, { default_tax_class_id: c.id }, `Default class: ${c.name}`)}
                        style={({ hovered }: any) => [{
                          minHeight: 44, paddingHorizontal: 14, justifyContent: 'center', borderRadius: 10, borderWidth: 1.5,
                          borderColor: selected ? colors.primary : colors.border,
                          backgroundColor: selected ? colors.primarySoft : hovered ? colors.surfaceSunken : colors.surface,
                        }, Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}>
                        <Text variant="smallStrong" color={selected ? colors.primarySoftText : colors.text}>{c.name} · {formatRate(c.current_rate)}%</Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : (
                <Text variant="bodyStrong">{defaultClass ? `${defaultClass.name} · ${formatRate(defaultClass.current_rate)}%` : t('common.not_set')}</Text>
              )}
              <Text variant="small" tone="subtle">{t('settings.TaxesScreen.items_without_their_own_tax_class_use')}</Text>
            </View>
            {data.products_without_class > 0 ? (
              <Callout tone="warning" icon="pricetags-outline" title={t('settings.TaxesScreen.products_without_class_item_v_no_tax_class', { products_without_class: data.products_without_class, v: data.products_without_class === 1 ? t('settings.TaxesScreen.has') : t('settings.TaxesScreen.s_have') })}
                action={editable && active.length ? <Button title={t('settings.TaxesScreen.assign_classes')} size="sm" variant="secondary" icon="git-merge-outline" onPress={() => setAssigning({})} /> : undefined}>
                {t('settings.TaxesScreen.they_use_the_default_class_v_or_an_old', { v: defaultClass ? ` (${defaultClass.name}, ${formatRate(defaultClass.current_rate)}%)` : '' })}
              </Callout>
            ) : null}
          </FormSection>

          {/* Classes */}
          <View style={{ gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <View style={{ flex: 1, minWidth: 220, gap: 2 }}>
                <Text variant="h3" accessibilityRole="header">{t('settings.TaxesScreen.tax_classes')}</Text>
                <Text variant="small" tone="muted">{t('settings.TaxesScreen.groups_of_items_taxed_the_same_way_tap_a')}</Text>
              </View>
              {editable && active.length ? (
                <Button title={t('settings.TaxesScreen.assign_to_items')} variant="secondary" icon="git-merge-outline" size="sm" onPress={() => setAssigning({})} />
              ) : null}
            </View>
            {classes.length ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }} onLayout={(e) => setGridWidth(e.nativeEvent.layout.width)}>
                {classes.map((c) => (
                  <View key={c.id} style={{ width: twoCol && gridWidth ? (gridWidth - 12) / 2 : '100%' }}>
                    <ClassCard taxClass={c} onPress={() => setDetailId(c.id)} />
                  </View>
                ))}
              </View>
            ) : (
              <Card>
                <EmptyState icon="calculator-outline" title={t('settings.TaxesScreen.no_tax_classes_yet')} message={t('settings.TaxesScreen.add_one_from_the_gst_library_to_start')}
                  action={editable ? { label: t('settings.TaxesScreen.add_tax_class'), icon: 'add', onPress: () => setAdding(true) } : undefined} />
              </Card>
            )}
          </View>
        </>,
      )}

      {detail ? (
        <ClassDetailSheet taxClass={detail} canEdit={canEdit} online={online} onClose={() => setDetailId(null)} onChanged={(o) => { setData(o); void syncNow(); }}
          onAssign={() => { setDetailId(null); setAssigning({ classId: detail.id }); }} />
      ) : null}
      {adding ? <AddClassSheet classes={classes} onClose={() => setAdding(false)} onCreated={(o) => setData(o)} /> : null}
      {assigning ? (
        <AssignSheet classes={classes} defaultClass={defaultClass} initialClassId={assigning.classId} onClose={() => setAssigning(null)}
          onDone={() => { setAssigning(null); void reload(); void syncNow(); }} />
      ) : null}
      <TopDialogHost />
    </>
  );
}

function ClassCard({ taxClass: c, onPress }: { taxClass: TaxClass; onPress: () => void }) {
  const next = upcomingRates(c)[0];
  return (
    <Card onPress={onPress} style={{ gap: 10, opacity: c.is_active ? 1 : 0.75, height: '100%' }}>
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text variant="bodyStrong" numberOfLines={2}>{c.name}</Text>
          <Text variant="small" tone="muted">{c.current_rate === null ? t('settings.TaxesScreen.no_rate_yet') : describeComponents(c.current_components, c.current_rate)}</Text>
          <Text variant="small" tone="subtle">
            {[`${c.products} item${c.products === 1 ? '' : 's'}`, c.hsn_sac ? `HSN/SAC ${c.hsn_sac}` : null].filter(Boolean).join(' · ')}
          </Text>
        </View>
        <RatePill rate={c.current_rate} muted={!c.is_active} />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {c.is_default ? <Badge label={t('settings.TaxesScreen.default')} tone="primary" icon="star" /> : null}
        {next ? <Badge label={t('settings.TaxesScreen.upcoming_change_on_formateffective', { formatEffective: formatEffective(next.effective_from, false), formatRate: formatRate(next.total_rate) })} tone="warning" icon="time-outline" /> : null}
        {c.follow_preset ? <Badge label={t('settings.TaxesScreen.follows_brand_gst_library', { brand: brand.name })} tone="info" icon="sync" /> : null}
        {!c.is_active ? <Badge label={t('settings.TaxesScreen.turned_off')} tone="neutral" /> : null}
      </View>
    </Card>
  );
}
