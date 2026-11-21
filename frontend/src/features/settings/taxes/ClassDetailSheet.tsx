/**
 * One tax class: rate history timeline, "schedule a rate change" (the government changed GST for my items),
 * cancel an upcoming change, rename / HSN-SAC / follow the library / turn off.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { errorMessage } from '@/api/client';
import {
  describeComponents, formatRate, sortedRates, splitGst, taxesApi, type TaxClass, type TaxOverview, type TaxRateVersion,
} from '@/api/taxes';
import { Badge, Button, Input, Sheet, Text, toast } from '@/components/ui';
import { confirmTop as confirm } from '@/features/catalog/dialogs';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { Callout, ChoiceChips, FieldRow, Hairline, SettingSwitch } from '../components';
import { DateTimeField, RatePill, formatEffective, tomorrowMidnight } from './shared';
import { brand } from '@/config/brand';
import { t as tr } from '@/i18n';

const QUICK_RATES = [0, 3, 5, 18, 40];
const HSN_PATTERN = /^[0-9]{4,8}$/;

function rateBefore(rates: TaxRateVersion[], at: Date): TaxRateVersion | null {
  const t = at.getTime();
  return sortedRates(rates).find((r) => new Date(r.effective_from).getTime() <= t) ?? null;
}

function parseRate(text: string): number | null {
  if (!text.trim()) return null;
  const n = Number(text.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export function ClassDetailSheet({ taxClass, canEdit, online, onClose, onChanged, onAssign }: {
  taxClass: TaxClass; canEdit: boolean; online: boolean; onClose: () => void; onChanged: (o: TaxOverview) => void;
  /** Open bulk assignment with this class picked */
  onAssign?: () => void;
}) {
  const { colors } = useTheme();
  const { isPhone } = useLayout();
  const editable = canEdit && online;
  const history = useMemo(() => sortedRates(taxClass.rates), [taxClass.rates]);

  // --- schedule a change ---
  const [scheduling, setScheduling] = useState(false);
  const [rateText, setRateText] = useState('');
  const [when, setWhen] = useState<Date | null>(() => tomorrowMidnight());
  const [note, setNote] = useState('');
  const [igst, setIgst] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState<null | 'schedule' | 'details' | 'active' | string>(null);

  // --- details ---
  const [name, setName] = useState(taxClass.name);
  const [hsn, setHsn] = useState(taxClass.hsn_sac ?? '');
  useEffect(() => {
    setName(taxClass.name);
    setHsn(taxClass.hsn_sac ?? '');
  }, [taxClass.id, taxClass.name, taxClass.hsn_sac]);

  const rate = parseRate(rateText);
  const previous = when ? rateBefore(taxClass.rates, when) : null;
  const rateError = !rateText.trim() ? 'Enter the new GST rate.' : rate === null || rate < 0 || rate > 100 ? 'Use a rate from 0 to 100.' : null;
  const whenError = !when
    ? 'Enter a valid date and time.'
    : when.getTime() < Date.now() - 60_000
      ? "A change can't start in the past — bills already issued keep their tax."
      : taxClass.rates.some((r) => new Date(r.effective_from).getTime() === when.getTime())
        ? 'A change is already scheduled at that exact time.'
        : null;
  const sameRate = rate !== null && previous && Number(previous.total_rate) === rate && !igst;
  const scheduleInvalid = !!rateError || !!whenError || note.length > 300;

  const components = rate !== null ? (igst ? [{ name: 'IGST', rate }] : splitGst(rate)) : [];
  const previewText = rate !== null && when
    ? `From ${formatEffective(when)}, ${taxClass.name}: ${previous ? `${formatRate(previous.total_rate)}% → ` : ''}${formatRate(rate)}% (${describeComponents(components, rate)})`
    : null;

  const resetSchedule = () => {
    setScheduling(false);
    setRateText('');
    setWhen(tomorrowMidnight());
    setNote('');
    setIgst(false);
    setSubmitted(false);
  };

  const schedule = async () => {
    setSubmitted(true);
    if (scheduleInvalid || rate === null || !when) return;
    const ok = await confirm({
      title: tr('settings.taxes_ClassDetailSheet.schedule_this_gst_change'),
      message: `${previewText}.\n\nBills made before then keep the old rate. ${taxClass.follow_preset ? `This class will stop following the ${brand.name} GST library, so later government changes will not be applied to it automatically.` : ''}`.trim(),
      confirmLabel: tr('settings.taxes_ClassDetailSheet.schedule_change'),
    });
    if (!ok) return;
    setBusy('schedule');
    try {
      const overview = await taxesApi.scheduleRate(taxClass.id, { rate, effective_from: when.toISOString(), note: note.trim() || null, igst_only: igst });
      onChanged(overview);
      toast.success(tr('settings.taxes_ClassDetailSheet.name_formatrate_from_formateffective', { name: taxClass.name, formatRate: formatRate(rate), formatEffective: formatEffective(when) }));
      resetSchedule();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const cancelChange = async (r: TaxRateVersion) => {
    const ok = await confirm({
      title: tr('settings.taxes_ClassDetailSheet.cancel_this_rate_change'),
      message: tr('settings.taxes_ClassDetailSheet.name_will_not_change_to_formatrate_on', { name: taxClass.name, formatRate: formatRate(r.total_rate), formatEffective: formatEffective(r.effective_from) }),
      confirmLabel: tr('settings.taxes_ClassDetailSheet.cancel_change'),
      danger: true,
    });
    if (!ok) return;
    setBusy(r.id);
    try {
      onChanged(await taxesApi.cancelRate(taxClass.id, r.id));
      toast.success(tr('settings.taxes_ClassDetailSheet.scheduled_change_cancelled'));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const nameError = name.trim().length < 2 ? 'Use at least 2 characters.' : name.trim().length > 80 ? 'Use 80 characters or fewer.' : null;
  const hsnError = hsn.trim() && !HSN_PATTERN.test(hsn.trim()) ? 'HSN/SAC is 4 to 8 digits.' : null;
  const detailsDirty = name.trim() !== taxClass.name || (hsn.trim() || null) !== (taxClass.hsn_sac ?? null);

  const saveDetails = async () => {
    if (nameError || hsnError) return;
    setBusy('details');
    try {
      onChanged(await taxesApi.update(taxClass.id, { name: name.trim(), hsn_sac: hsn.trim() }));
      toast.success(tr('settings.taxes_ClassDetailSheet.tax_class_saved'));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const setFollow = async (follow: boolean) => {
    setBusy('follow');
    try {
      onChanged(await taxesApi.update(taxClass.id, { follow_preset: follow }));
      toast.success(follow ? tr('settings.taxes_ClassDetailSheet.now_follows_the_brand_gst_library', { brand: brand.name }) : tr('settings.taxes_ClassDetailSheet.stopped_following_the_gst_library'));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const toggleActive = async () => {
    const turningOff = taxClass.is_active;
    if (turningOff) {
      const ok = await confirm({
        title: tr('settings.taxes_ClassDetailSheet.turn_off_name', { name: taxClass.name }),
        message: taxClass.products
          ? tr('settings.taxes_ClassDetailSheet.products_item_v_use_this_class_they_will', { products: taxClass.products, v: taxClass.products === 1 ? '' : 's' })
          : tr('settings.taxes_ClassDetailSheet.it_will_no_longer_be_offered_for_items'),
        confirmLabel: tr('settings.taxes_ClassDetailSheet.turn_off'),
        danger: true,
      });
      if (!ok) return;
    }
    setBusy('active');
    try {
      onChanged(await taxesApi.update(taxClass.id, { is_active: !turningOff }));
      toast.success(turningOff ? tr('settings.taxes_ClassDetailSheet.name_turned_off', { name: taxClass.name }) : tr('settings.taxes_ClassDetailSheet.name_turned_on', { name: taxClass.name }));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const anyBusy = busy !== null;
  const current = history.find((r) => r.current) ?? null;

  return (
    <Sheet visible onClose={anyBusy ? () => undefined : onClose} title={taxClass.name} width={680}
      subtitle={tr('settings.taxes_ClassDetailSheet.v_products_item_v2', { v: taxClass.current_rate === null ? tr('settings.taxes_ClassDetailSheet.no_rate_yet') : tr('settings.taxes_ClassDetailSheet.gst_formatrate_describecomponents', { formatRate: formatRate(taxClass.current_rate), describeComponents: describeComponents(taxClass.current_components, taxClass.current_rate) }), products: taxClass.products, v2: taxClass.products === 1 ? '' : 's' })}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {taxClass.is_default ? <Badge label={tr('settings.taxes_ClassDetailSheet.business_default')} tone="primary" icon="star" /> : null}
        {taxClass.follow_preset ? <Badge label={tr('settings.taxes_ClassDetailSheet.follows_brand_gst_library', { brand: brand.name })} tone="info" icon="sync" /> : taxClass.preset_key ? <Badge label={tr('settings.taxes_ClassDetailSheet.managed_by_you')} tone="neutral" /> : null}
        {!taxClass.is_active ? <Badge label={tr('settings.taxes_ClassDetailSheet.turned_off')} tone="warning" /> : null}
        {taxClass.hsn_sac ? <Badge label={tr('settings.taxes_ClassDetailSheet.hsn_sac_hsn_sac', { hsn_sac: taxClass.hsn_sac })} tone="neutral" /> : null}
      </View>
      {onAssign && editable && taxClass.is_active ? (
        <Button title={taxClass.products ? tr('settings.taxes_ClassDetailSheet.add_more_items_to_name', { name: taxClass.name }) : tr('settings.taxes_ClassDetailSheet.assign_items_to_name', { name: taxClass.name })} icon="git-merge-outline" variant="secondary"
          size="sm" onPress={onAssign} disabled={anyBusy} style={{ alignSelf: 'flex-start' }} />
      ) : null}

      {/* Rate history */}
      <View style={{ gap: 4 }}>
        <Text variant="h3">{tr('settings.taxes_ClassDetailSheet.rate_history')}</Text>
        <Text variant="small" tone="muted">{tr('settings.taxes_ClassDetailSheet.each_bill_keeps_the_rate_that_applied')}</Text>
      </View>
      <View>
        {history.map((r, i) => {
          const tone = r.upcoming ? colors.warning : r.current ? colors.primary : colors.borderStrong;
          const last = i === history.length - 1;
          return (
            <View key={r.id} style={{ flexDirection: 'row', gap: 12 }}>
              <View style={{ width: 16, alignItems: 'center' }}>
                <View style={{ width: 12, height: 12, borderRadius: 6, marginTop: 5, backgroundColor: r.upcoming ? colors.surface : tone, borderWidth: 2, borderColor: tone }} />
                {!last ? <View style={{ flex: 1, width: 2, backgroundColor: colors.border, marginVertical: 2 }} /> : null}
              </View>
              <View style={{ flex: 1, minWidth: 0, paddingBottom: last ? 0 : 16, gap: 2 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <Text variant="bodyStrong">{formatRate(r.total_rate)}%</Text>
                  <Text variant="small" tone="muted">{describeComponents(r.components, r.total_rate)}</Text>
                  {r.current ? <Badge label={tr('common.current')} tone="success" /> : null}
                  {r.upcoming ? <Badge label={tr('settings.taxes_ClassDetailSheet.upcoming')} tone="warning" icon="time-outline" /> : null}
                </View>
                <Text variant="small">{r.upcoming ? tr('settings.taxes_ClassDetailSheet.starts') : tr('common.from')} {formatEffective(r.effective_from)}</Text>
                <Text variant="small" tone="subtle">
                  {[r.note, r.source === 'preset' ? `${brand.name} GST library` : 'Set by your business'].filter(Boolean).join(' · ')}
                </Text>
                {r.upcoming && editable ? (
                  <Button title={tr('settings.taxes_ClassDetailSheet.cancel_this_change')} size="sm" variant="ghost" icon="close-circle-outline" onPress={() => cancelChange(r)}
                    loading={busy === r.id} disabled={anyBusy} style={{ alignSelf: 'flex-start', marginLeft: -12 }} />
                ) : null}
              </View>
            </View>
          );
        })}
        {!history.length ? <Text tone="muted">{tr('settings.taxes_ClassDetailSheet.no_rate_set_yet')}</Text> : null}
      </View>

      {/* Schedule a change */}
      {canEdit && taxClass.is_active ? (
        <View style={{ gap: 12, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: scheduling ? colors.primary : colors.border,
          backgroundColor: scheduling ? colors.surfaceAlt : colors.surface }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Ionicons name="calendar-outline" size={20} color={colors.primary} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text variant="bodyStrong">{tr('settings.taxes_ClassDetailSheet.government_changed_the_rate')}</Text>
              <Text variant="small" tone="muted">{tr('settings.taxes_ClassDetailSheet.schedule_the_new_rate_bills_switch')}</Text>
            </View>
            {!scheduling ? <Button title={tr('settings.taxes_ClassDetailSheet.schedule_change')} size="sm" variant="soft" icon="add" onPress={() => setScheduling(true)} disabled={!online} /> : null}
          </View>
          {scheduling ? (
            <>
              <View style={{ gap: 6 }}>
                <Input label={tr('settings.taxes_ClassDetailSheet.new_gst_rate')} value={rateText} onChangeText={(t) => setRateText(t.replace(/[^\d.,]/g, ''))} keyboardType="decimal-pad"
                  maxLength={6} placeholder={current ? formatRate(current.total_rate) : '5'} right={<Text tone="muted" style={{ marginRight: 12 }}>%</Text>}
                  error={submitted ? rateError : null} containerStyle={{ maxWidth: isPhone ? undefined : 220 }} />
                <ChoiceChips<number> value={rate ?? -1} onChange={(v) => setRateText(String(v))} accessibilityLabel={tr('common.common_gst_rates')}
                  options={QUICK_RATES.map((r) => ({ value: r, label: `${r}%` }))} />
              </View>
              <DateTimeField value={when} onChange={setWhen} error={submitted || when === null ? whenError : null} />
              <Input label={tr('settings.taxes_ClassDetailSheet.government_notification_optional')} value={note} onChangeText={setNote} maxLength={300}
                placeholder={tr('settings.taxes_ClassDetailSheet.e_g_notification_no_9_2025_central_tax')} hint={tr('settings.taxes_ClassDetailSheet.kept_with_the_rate_so_you_can_show_where')} />
              <SettingSwitch title={tr('settings.taxes_ClassDetailSheet.charge_as_igst_only')} value={igst} onValueChange={setIgst}
                subtitle={tr('settings.taxes_ClassDetailSheet.only_for_businesses_that_bill_inter_state')} />
              {previewText ? (
                <Callout tone={sameRate ? 'warning' : 'info'} icon="eye-outline" title={tr('common.preview')}>
                  {sameRate ? tr('settings.taxes_ClassDetailSheet.previewtext_this_is_the_same_as_the_rate', { previewText }) : previewText}
                </Callout>
              ) : null}
              {taxClass.follow_preset ? (
                <Text variant="small" tone="warning">{tr('settings.taxes_ClassDetailSheet.scheduling_your_own_change_stops', { brand: brand.name })}</Text>
              ) : null}
              <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                <Button title={tr('common.cancel')} variant="secondary" onPress={resetSchedule} disabled={anyBusy} />
                <Button title={tr('settings.taxes_ClassDetailSheet.review_schedule')} icon="checkmark" onPress={schedule} loading={busy === 'schedule'} disabled={anyBusy || !online || (submitted && scheduleInvalid)} />
              </View>
            </>
          ) : null}
        </View>
      ) : null}

      {/* Details */}
      {canEdit ? (
        <>
          <Hairline />
          <Text variant="h3">{tr('settings.taxes_ClassDetailSheet.details')}</Text>
          <FieldRow>
            <Input label={tr('common.name')} value={name} onChangeText={setName} maxLength={80} error={nameError} editable={editable} />
            <Input label={tr('settings.taxes_ClassDetailSheet.hsn_sac_code')} value={hsn} onChangeText={(t) => setHsn(t.replace(/\D/g, ''))} maxLength={8} keyboardType="number-pad"
              error={hsnError} hint={tr('settings.taxes_ClassDetailSheet.printed_on_tax_invoices_4_8_digits')} editable={editable} placeholder={tr('settings.taxes_ClassDetailSheet.e_g_996331')} />
          </FieldRow>
          {detailsDirty ? (
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
              <Button title={tr('settings.taxes_ClassDetailSheet.undo')} variant="secondary" onPress={() => { setName(taxClass.name); setHsn(taxClass.hsn_sac ?? ''); }} disabled={anyBusy} />
              <Button title={tr('settings.taxes_ClassDetailSheet.save_details')} icon="checkmark" onPress={saveDetails} loading={busy === 'details'} disabled={anyBusy || !online || !!nameError || !!hsnError} />
            </View>
          ) : null}
          {taxClass.preset_key ? (
            <SettingSwitch title={tr('settings.taxes_ClassDetailSheet.follow_the_brand_gst_library', { brand: brand.name })} value={taxClass.follow_preset} onValueChange={setFollow} disabled={!editable || anyBusy}
              subtitle={tr('settings.taxes_ClassDetailSheet.when_the_government_changes_this_slab', { brand: brand.name })} />
          ) : null}
          <Hairline />
          <View style={{ flexDirection: isPhone ? 'column' : 'row', gap: 10, alignItems: isPhone ? 'stretch' : 'center' }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text variant="bodyStrong">{taxClass.is_active ? tr('settings.taxes_ClassDetailSheet.turn_off_this_class') : tr('settings.taxes_ClassDetailSheet.this_class_is_turned_off')}</Text>
              <Text variant="small" tone="muted">
                {taxClass.is_default && taxClass.is_active ? tr('settings.taxes_ClassDetailSheet.choose_another_default_class_before')
                  : taxClass.is_active ? tr('settings.taxes_ClassDetailSheet.items_using_it_fall_back_to_your_default') : tr('settings.taxes_ClassDetailSheet.turn_it_on_to_use_it_for_items_again')}
              </Text>
            </View>
            <Button title={taxClass.is_active ? tr('settings.taxes_ClassDetailSheet.turn_off') : tr('settings.taxes_ClassDetailSheet.turn_on')} variant={taxClass.is_active ? 'secondary' : 'soft'}
              icon={taxClass.is_active ? 'pause-circle-outline' : 'play-circle-outline'} onPress={toggleActive} loading={busy === 'active'}
              disabled={anyBusy || !online || (taxClass.is_default && taxClass.is_active)} />
          </View>
        </>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <RatePill rate={taxClass.current_rate} muted={!taxClass.is_active} />
          <Text variant="small" tone="muted" style={{ flex: 1 }}>{tr('settings.taxes_ClassDetailSheet.ask_the_owner_or_a_manager_to_change_this')}</Text>
        </View>
      )}
    </Sheet>
  );
}
