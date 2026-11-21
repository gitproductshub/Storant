/**
 * Platform GST rate library. When the government changes a GST rate, publish the new rate with its effective date:
 * every business tax class that follows the preset gets it scheduled, bills switch at that moment and older bills keep their GST.
 */
import React, { useState } from 'react';
import { View } from 'react-native';
import { errorMessage } from '@/api/client';
import { platformApi, type TaxPreset, type TaxRateVersion } from '@/api/platform';
import { Badge, Button, Card, Divider, EmptyState, ErrorState, Input, Loading, Sheet, Text, toast } from '@/components/ui';
import { useApi } from '@/hooks/useApi';
import { useLayout } from '@/theme/ThemeProvider';
import { Callout, ChoiceChips, FieldRow, monoFont } from '@/features/settings/components';
import { fieldErrorsFrom } from '@/features/settings/validation';
import { AdminPage, ReadOnlyNote, istDate, istMidnightIso, shortDate, useCanEdit, useOnline } from './shared';
import { t } from '@/i18n';

const COMMON_RATES = [0, 5, 18, 40, 3, 12, 28];

function rateText(rate: number | null | undefined): string {
  if (rate === null || rate === undefined) return '—';
  return `${Number(rate.toFixed(3))}%`;
}

function componentsText(v: TaxRateVersion): string {
  if (!v.components?.length) return 'No tax';
  return v.components.map((c) => `${c.name} ${rateText(c.rate)}`).join(' + ');
}

function validRate(value: string): number | null {
  const v = value.trim();
  if (!/^\d{1,3}(\.\d{1,3})?$/.test(v)) return null;
  const n = Number(v);
  return n >= 0 && n <= 100 ? n : null;
}

export default function TaxScreen() {
  const canEdit = useCanEdit();
  const { data, error, loading, refreshing, reload, setData, silentReload } = useApi(() => platformApi.taxPresets(), []);
  const [schedule, setSchedule] = useState<TaxPreset | null>(null);
  const [creating, setCreating] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const upcoming = (data ?? []).filter((p) => p.versions.some((v) => v.upcoming)).length;

  return (
    <AdminPage
      title={t('common.gst_rate_library')}
      subtitle={t('admin.TaxScreen.standard_gst_slabs_businesses_pick_for')}
      refreshing={refreshing}
      onRefresh={reload}
      actions={canEdit ? <Button title={t('admin.TaxScreen.new_slab')} icon="add" variant="secondary" onPress={() => setCreating(true)} /> : null}
    >
      {!canEdit ? <ReadOnlyNote what="change GST rates" /> : null}
      {loading && !data ? <Loading label={t('admin.TaxScreen.loading_gst_slabs')} /> : null}
      {error && !data ? <ErrorState message={error} onRetry={reload} /> : null}
      {data && data.length === 0 ? <EmptyState icon="receipt-outline" title={t('admin.TaxScreen.no_gst_slabs')} message={t('admin.TaxScreen.built_in_slabs_are_added_automatically')} /> : null}
      {upcoming ? (
        <Callout tone="info" icon="calendar-outline" title={t('admin.TaxScreen.upcoming_scheduled_rate_change_v', { upcoming, v: upcoming === 1 ? '' : 's' })}>
          {t('admin.TaxScreen.bills_switch_to_the_new_rate')}
        </Callout>
      ) : null}

      {(data ?? []).map((p) => (
        <PresetCard key={p.key} preset={p} canEdit={canEdit} expanded={!!expanded[p.key]}
          onToggle={() => setExpanded((s) => ({ ...s, [p.key]: !s[p.key] }))} onSchedule={() => setSchedule(p)} />
      ))}

      {schedule ? (
        <ScheduleRateSheet preset={schedule} onClose={() => setSchedule(null)}
          onDone={() => { setExpanded((s) => ({ ...s, [schedule.key]: true })); setSchedule(null); void silentReload(); }} />
      ) : null}
      {creating ? (
        <NewPresetSheet existing={data ?? []} onClose={() => setCreating(false)} onDone={(next) => { setData(next); setCreating(false); }} />
      ) : null}
    </AdminPage>
  );
}

function PresetCard({ preset: p, canEdit, expanded, onToggle, onSchedule }: {
  preset: TaxPreset; canEdit: boolean; expanded: boolean; onToggle: () => void; onSchedule: () => void;
}) {
  const { isPhone } = useLayout();
  const next = p.versions.filter((v) => v.upcoming).sort((a, b) => a.effective_from.localeCompare(b.effective_from))[0];
  const current = [...p.versions].filter((v) => !v.upcoming).sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0];
  const history = [...p.versions].sort((a, b) => b.effective_from.localeCompare(a.effective_from));
  return (
    <Card style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Text variant="h3">{p.name}</Text>
            {!p.is_active ? <Badge label={t('admin.TaxScreen.inactive')} tone="neutral" /> : null}
            {next ? <Badge label={t('admin.TaxScreen.ratetext_from_shortdate', { rateText: rateText(next.total_rate), shortDate: shortDate(next.effective_from) })} tone="info" icon="calendar-outline" /> : null}
          </View>
          <Text variant="caption" tone="subtle" style={{ fontFamily: monoFont }}>{p.key}{p.hsn_sac ? t('admin.TaxScreen.hsn_sac_hsn_sac', { hsn_sac: p.hsn_sac }) : ''}</Text>
          {p.description ? <Text variant="small" tone="muted">{p.description}</Text> : null}
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text variant={isPhone ? 'h1' : 'moneyLarge'}>{rateText(p.current_rate)}</Text>
          <Text variant="caption" tone="subtle" numberOfLines={1}>{current ? componentsText(current) : t('admin.TaxScreen.not_in_force_yet')}</Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Button title={expanded ? t('admin.TaxScreen.hide_history') : t('admin.TaxScreen.rate_history_length', { length: p.versions.length })} icon={expanded ? 'chevron-up' : 'chevron-down'} size="sm" variant="ghost" onPress={onToggle} />
        {canEdit ? <Button title={t('admin.TaxScreen.schedule_rate_change')} icon="calendar-outline" size="sm" variant="secondary" onPress={onSchedule} /> : null}
      </View>
      {expanded ? (
        <View>
          {history.map((v, i) => {
            const isCurrent = current?.id === v.id;
            return (
              <View key={v.id}>
                <Divider />
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 10 }}>
                  <View style={{ width: isPhone ? 92 : 120 }}>
                    <Text variant="smallStrong">{shortDate(v.effective_from)}</Text>
                    <Text variant="caption" tone="subtle">{i === history.length - 1 ? t('admin.TaxScreen.first_rate') : t('admin.TaxScreen.effective_from')}</Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <Text variant="bodyStrong">{rateText(v.total_rate)}</Text>
                      {v.upcoming ? <Badge label={t('admin.TaxScreen.upcoming')} tone="info" /> : isCurrent ? <Badge label={t('common.current')} tone="success" /> : <Badge label={t('admin.TaxScreen.past')} tone="neutral" />}
                    </View>
                    <Text variant="small" tone="muted">{componentsText(v)}</Text>
                    {v.note ? <Text variant="small" tone="subtle">{v.note}</Text> : null}
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      ) : null}
    </Card>
  );
}

function RateField({ value, onChange, error }: { value: string; onChange: (v: string) => void; error?: string }) {
  const n = validRate(value);
  return (
    <View style={{ gap: 6 }}>
      <Text variant="smallStrong" tone="muted">{t('admin.TaxScreen.new_total_gst_rate')}</Text>
      <ChoiceChips value={n !== null && COMMON_RATES.includes(n) ? String(n) : ''} onChange={onChange} accessibilityLabel={t('common.common_gst_rates')}
        options={COMMON_RATES.map((r) => ({ value: String(r), label: `${r}%` }))} />
      <Input value={value} onChangeText={(v) => onChange(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" maxLength={7} error={error}
        accessibilityLabel={t('admin.TaxScreen.gst_rate_in_percent')} placeholder={t('admin.TaxScreen.e_g_18')} right={<Text tone="muted" style={{ marginRight: 12 }}>%</Text>}
        hint={n !== null ? (n === 0 ? t('admin.TaxScreen.nil_rated_no_cgst_sgst') : t('admin.TaxScreen.intra_state_cgst_ratetext_sgst_ratetext', { rateText: rateText(n / 2), rateText2: rateText(n) })) : undefined} />
    </View>
  );
}

function ScheduleRateSheet({ preset: p, onClose, onDone }: { preset: TaxPreset; onClose: () => void; onDone: () => void }) {
  const online = useOnline();
  const [rate, setRate] = useState('');
  const [date, setDate] = useState(istDate(1));
  const [note, setNote] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const n = validRate(rate);
  const effective = istMidnightIso(date);
  const errors = {
    rate: n === null ? 'Enter a rate between 0 and 100.' : n === p.current_rate && date <= istDate() ? 'That is already the current rate.' : undefined,
    date: !effective ? 'Use the format YYYY-MM-DD.' : undefined,
  };
  const invalid = Object.values(errors).some(Boolean);
  const past = !!effective && date < istDate();

  const review = () => {
    setSubmitted(true);
    setFormError(null);
    if (!invalid) setReviewing(true);
  };

  const publish = async () => {
    if (invalid || n === null || !effective) return;
    setSaving(true);
    try {
      const r = await platformApi.publishTaxRate(p.key, { rate: n, effective_from: effective, note: note.trim() || null });
      toast.success(t('admin.TaxScreen.name_ratetext_from_shortdate_businesses', { name: p.name, rateText: rateText(n), shortDate: shortDate(effective), businesses_updated: r.businesses_updated, v: r.businesses_updated === 1 ? '' : 'es' }));
      onDone();
    } catch (e) {
      setFormError(errorMessage(e));
      setReviewing(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet visible onClose={onClose} title={t('admin.TaxScreen.schedule_gst_rate_change')} subtitle={t('admin.TaxScreen.name_now_ratetext', { name: p.name, rateText: rateText(p.current_rate) })} width={580}
      footer={
        <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'flex-end' }}>
          {reviewing ? (
            <>
              <Button title={t('common.back')} variant="secondary" onPress={() => setReviewing(false)} disabled={saving} />
              <Button title={t('admin.TaxScreen.publish_rate')} icon="megaphone-outline" onPress={publish} loading={saving} disabled={!online} />
            </>
          ) : (
            <>
              <Button title={t('common.cancel')} variant="secondary" onPress={onClose} />
              <Button title={t('admin.TaxScreen.review')} icon="arrow-forward" onPress={review} />
            </>
          )}
        </View>
      }>
      {formError ? <Callout tone="danger">{formError}</Callout> : null}
      {!online ? <Callout tone="warning">{t('admin.TaxScreen.you_re_offline_connect_to_publish_the_rate')}</Callout> : null}
      {reviewing && n !== null && effective ? (
        <>
          <Callout tone="warning" title={t('admin.TaxScreen.publish_ratetext_for_name_from_shortdate', { rateText: rateText(n), name: p.name, shortDate: shortDate(effective) })}>
            {t('admin.TaxScreen.every_business_whose_tax_class_follows', { rateText: rateText(n), shortDate: shortDate(effective) })}
          </Callout>
          <Card style={{ gap: 6 }}>
            <Text variant="small" tone="muted">{t('admin.TaxScreen.rate')}</Text>
            <Text variant="h2">{rateText(p.current_rate)} → {rateText(n)}</Text>
            <Text variant="small" tone="muted" style={{ marginTop: 6 }}>{t('admin.TaxScreen.effective')}</Text>
            <Text variant="bodyStrong">{shortDate(effective)}{t('admin.TaxScreen.00_00_ist')}</Text>
            {note.trim() ? (
              <>
                <Text variant="small" tone="muted" style={{ marginTop: 6 }}>{t('admin.TaxScreen.note')}</Text>
                <Text>{note.trim()}</Text>
              </>
            ) : null}
          </Card>
        </>
      ) : (
        <>
          <RateField value={rate} onChange={setRate} error={submitted ? errors.rate : undefined} />
          <Input label={t('admin.TaxScreen.effective_from_india_date')} required value={date} onChangeText={setDate} maxLength={10} placeholder={t('common.yyyy_mm_dd')}
            error={submitted ? errors.date : undefined} autoCapitalize="none" autoCorrect={false}
            hint={effective ? t('admin.TaxScreen.starts_shortdate_at_00_00_ist', { shortDate: shortDate(effective) }) : t('admin.TaxScreen.yyyy_mm_dd_e_g_2026_11_01')} />
          {past ? <Callout tone="warning">{t('admin.TaxScreen.this_date_is_in_the_past_bills_already')}</Callout> : null}
          <Input label={t('admin.TaxScreen.note')} value={note} onChangeText={setNote} maxLength={300} placeholder={t('admin.TaxScreen.e_g_cbic_notification_09_2026_ct_rate')}
            hint={t('admin.TaxScreen.shown_in_the_rate_history_and_the_audit')} />
        </>
      )}
    </Sheet>
  );
}

function NewPresetSheet({ existing, onClose, onDone }: { existing: TaxPreset[]; onClose: () => void; onDone: (next: TaxPreset[]) => void }) {
  const online = useOnline();
  const [key, setKey] = useState('GST_');
  const [name, setName] = useState('');
  const [hsn, setHsn] = useState('');
  const [description, setDescription] = useState('');
  const [rate, setRate] = useState('');
  const [date, setDate] = useState(istDate());
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const n = validRate(rate);
  const effective = istMidnightIso(date);
  const errors: Record<string, string | undefined> = {
    key: !/^[A-Z0-9_]{2,40}$/.test(key) ? 'Capital letters, digits and _ (2–40).' : existing.some((p) => p.key === key) ? 'A slab with this key exists.' : undefined,
    name: name.trim().length < 2 ? 'At least 2 characters.' : undefined,
    rate: n === null ? 'Enter a rate between 0 and 100.' : undefined,
    effective_from: !effective ? 'Use the format YYYY-MM-DD.' : undefined,
    hsn_sac: hsn.trim() && !/^\d{4,8}$/.test(hsn.trim()) ? '4 to 8 digits.' : undefined,
  };
  const show = (k: string) => serverErrors[k] || (submitted ? errors[k] : undefined);

  const submit = async () => {
    setSubmitted(true);
    setFormError(null);
    if (Object.values(errors).some(Boolean) || n === null || !effective) return;
    setSaving(true);
    try {
      const next = await platformApi.createTaxPreset({
        key, name: name.trim(), hsn_sac: hsn.trim() || null, description: description.trim() || null, rate: n, effective_from: effective,
      });
      toast.success(t('admin.TaxScreen.trim_added_to_the_gst_library', { trim: name.trim() }));
      onDone(next);
    } catch (e) {
      setServerErrors(fieldErrorsFrom(e));
      setFormError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet visible onClose={onClose} title={t('admin.TaxScreen.new_gst_slab')} subtitle={t('admin.TaxScreen.businesses_can_pick_it_for_their_items')} width={620}
      footer={
        <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'flex-end' }}>
          <Button title={t('common.cancel')} variant="secondary" onPress={onClose} disabled={saving} />
          <Button title={t('admin.TaxScreen.add_slab')} icon="checkmark" onPress={submit} loading={saving} disabled={!online} />
        </View>
      }>
      {formError ? <Callout tone="danger">{formError}</Callout> : null}
      <FieldRow>
        <Input label={t('common.name')} required value={name} onChangeText={setName} maxLength={80} error={show('name')} placeholder={t('admin.TaxScreen.e_g_gst_12_textiles')} autoFocus />
        <Input label={t('admin.TaxScreen.key')} required value={key} onChangeText={(v) => setKey(v.toUpperCase().replace(/[^A-Z0-9_]/g, ''))} maxLength={40} error={show('key')}
          autoCapitalize="characters" autoCorrect={false} hint={t('admin.TaxScreen.permanent_id_e_g_gst_12_textile')} />
      </FieldRow>
      <FieldRow>
        <Input label={t('admin.TaxScreen.hsn_sac_optional')} value={hsn} onChangeText={(v) => setHsn(v.replace(/[^0-9]/g, ''))} maxLength={8} keyboardType="number-pad" error={show('hsn_sac')} />
        <Input label={t('admin.TaxScreen.effective_from_india_date')} required value={date} onChangeText={setDate} maxLength={10} placeholder={t('common.yyyy_mm_dd')} error={show('effective_from')}
          autoCapitalize="none" autoCorrect={false} />
      </FieldRow>
      <Input label={t('common.description')} value={description} onChangeText={setDescription} maxLength={300} placeholder={t('admin.TaxScreen.which_goods_or_services_use_this_slab')} />
      <RateField value={rate} onChange={setRate} error={show('rate')} />
    </Sheet>
  );
}
