/** Add a tax class: copy a slab from the Storant GST library (keeps getting government changes) or a custom rate. */
import React, { useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { errorMessage } from '@/api/client';
import { describeComponents, formatRate, splitGst, taxesApi, type TaxClass, type TaxOverview, type TaxPreset } from '@/api/taxes';
import { Badge, Button, Input, Loading, Segmented, Sheet, Text, toast } from '@/components/ui';
import { useApi } from '@/hooks/useApi';
import { useTheme } from '@/theme/ThemeProvider';
import { Callout, ChoiceChips, FieldRow, SettingSwitch } from '../components';
import { brand } from '@/config/brand';
import { t as tr } from '@/i18n';

const QUICK_RATES = [0, 3, 5, 12, 18, 28, 40];
const HSN_PATTERN = /^[0-9]{4,8}$/;

export function AddClassSheet({ classes, onClose, onCreated }: {
  classes: TaxClass[]; onClose: () => void; onCreated: (o: TaxOverview) => void;
}) {
  const { colors, radius } = useTheme();
  const presets = useApi(() => taxesApi.presets(), [], { refetchOnFocus: false });
  const [mode, setMode] = useState<'library' | 'custom'>('library');
  const [presetKey, setPresetKey] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [rateText, setRateText] = useState('');
  const [hsn, setHsn] = useState('');
  const [follow, setFollow] = useState(true);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);

  const libraryFailed = !presets.loading && !presets.data;
  const effectiveMode = libraryFailed ? 'custom' : mode;
  const used = new Set(classes.map((c) => c.preset_key).filter(Boolean));
  const preset = presets.data?.find((p) => p.key === presetKey) ?? null;
  const rate = rateText.trim() ? Number(rateText.replace(',', '.')) : null;

  const pickPreset = (p: TaxPreset) => {
    setPresetKey(p.key);
    if (!nameTouched || !name.trim()) setName(p.name);
    if (!hsn.trim() && p.hsn_sac) setHsn(p.hsn_sac);
  };

  const errors = {
    preset: effectiveMode === 'library' && !preset ? 'Pick a GST slab from the library.' : null,
    rate: effectiveMode === 'custom' && (rate === null || !Number.isFinite(rate) || rate < 0 || rate > 100) ? 'Enter a rate from 0 to 100.' : null,
    name: name.trim().length < 2 ? 'Give the class a name, e.g. "Sweets" or "Packaged food".' : name.trim().length > 80 ? 'Use 80 characters or fewer.' : null,
    hsn: hsn.trim() && !HSN_PATTERN.test(hsn.trim()) ? 'HSN/SAC is 4 to 8 digits.' : null,
  };
  const invalid = Object.values(errors).some(Boolean);
  const show = (k: keyof typeof errors) => (submitted ? errors[k] : null);

  const create = async () => {
    setSubmitted(true);
    if (invalid) return;
    setSaving(true);
    try {
      const overview = await taxesApi.create(effectiveMode === 'library'
        ? { name: name.trim(), preset_key: presetKey, follow_preset: follow, hsn_sac: hsn.trim() || null }
        : { name: name.trim(), rate, hsn_sac: hsn.trim() || null });
      onCreated(overview);
      toast.success(tr('settings.taxes_AddClassSheet.trim_added', { trim: name.trim() }));
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet visible onClose={saving ? () => undefined : onClose} title={tr('settings.taxes_AddClassSheet.add_tax_class')} width={640}
      subtitle={tr('settings.taxes_AddClassSheet.group_items_that_are_taxed_the_same_way_e')}
      footer={
        <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'flex-end' }}>
          <Button title={tr('common.cancel')} variant="secondary" onPress={onClose} disabled={saving} />
          <Button title={tr('settings.taxes_AddClassSheet.add_class')} icon="checkmark" onPress={create} loading={saving} disabled={saving || (submitted && invalid)} />
        </View>
      }>
      {!libraryFailed ? (
        <Segmented<'library' | 'custom'> value={mode} onChange={(v) => { setMode(v); setSubmitted(false); }}
          options={[{ value: 'library', label: tr('settings.taxes_AddClassSheet.from_gst_library'), icon: 'library-outline' }, { value: 'custom', label: tr('settings.taxes_AddClassSheet.custom_rate'), icon: 'create-outline' }]} />
      ) : (
        <Callout tone="warning" title={tr('settings.taxes_AddClassSheet.gst_library_unavailable')} action={<Button title={tr('common.try_again')} size="sm" variant="secondary" icon="refresh" onPress={presets.reload} />}>
          {tr('settings.taxes_AddClassSheet.couldn_t_load_the_brand_gst_library_v_you', { brand: brand.name, v: presets.error ?? tr('settings.taxes_AddClassSheet.unknown_error') })}
        </Callout>
      )}

      {effectiveMode === 'library' ? (
        presets.loading && !presets.data ? <Loading label={tr('settings.taxes_AddClassSheet.loading_gst_slabs')} /> : (
          <View style={{ gap: 8 }}>
            <Text variant="small" tone="muted">{tr('settings.taxes_AddClassSheet.slabs_from_the_gst_library_get_government')}</Text>
            {(presets.data ?? []).map((p) => {
              const selected = p.key === presetKey;
              return (
                <Pressable key={p.key} onPress={() => pickPreset(p)} accessibilityRole="radio" accessibilityState={{ checked: selected }}
                  accessibilityLabel={tr('settings.taxes_AddClassSheet.name_formatrate_percent', { name: p.name, formatRate: formatRate(p.current_rate) })}
                  style={({ hovered }: any) => [{
                    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: radius.md, borderWidth: 1.5,
                    borderColor: selected ? colors.primary : colors.border,
                    backgroundColor: selected ? colors.primarySoft : hovered ? colors.surfaceSunken : colors.surface,
                  }, Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}>
                  <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={20} color={selected ? colors.primary : colors.textSubtle} />
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      <Text variant="bodyStrong">{p.name}</Text>
                      {used.has(p.key) ? <Badge label={tr('settings.taxes_AddClassSheet.already_added')} tone="neutral" /> : null}
                    </View>
                    {p.description ? <Text variant="small" tone="muted" numberOfLines={2}>{p.description}</Text> : null}
                    <Text variant="caption" tone="subtle">
                      {[describeComponents(splitGst(p.current_rate ?? 0), p.current_rate), p.hsn_sac ? `HSN/SAC ${p.hsn_sac}` : null].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  <Text variant="h3" color={selected ? colors.primarySoftText : colors.text}>{formatRate(p.current_rate)}%</Text>
                </Pressable>
              );
            })}
            {show('preset') ? <Text variant="small" tone="danger">{show('preset')}</Text> : null}
          </View>
        )
      ) : (
        <View style={{ gap: 6 }}>
          <Input label={tr('settings.taxes_AddClassSheet.gst_rate')} required value={rateText} onChangeText={(t) => setRateText(t.replace(/[^\d.,]/g, ''))} keyboardType="decimal-pad"
            maxLength={6} placeholder="5" right={<Text tone="muted" style={{ marginRight: 12 }}>%</Text>} error={show('rate')}
            hint={rate !== null && Number.isFinite(rate) ? describeComponents(splitGst(rate), rate) : tr('settings.taxes_AddClassSheet.split_equally_into_cgst_and_sgst_on_bills')} />
          <ChoiceChips<number> value={rate ?? -1} onChange={(v) => setRateText(String(v))} accessibilityLabel={tr('common.common_gst_rates')}
            options={QUICK_RATES.map((r) => ({ value: r, label: `${r}%` }))} />
          <Text variant="small" tone="subtle">{tr('settings.taxes_AddClassSheet.custom_classes_don_t_get_government')}</Text>
        </View>
      )}

      <FieldRow>
        <Input label={tr('settings.taxes_AddClassSheet.class_name')} required value={name} onChangeText={(t) => { setName(t); setNameTouched(true); }} maxLength={80}
          placeholder={tr('settings.taxes_AddClassSheet.e_g_sweets')} error={show('name')} />
        <Input label={tr('settings.taxes_AddClassSheet.hsn_sac_code')} value={hsn} onChangeText={(t) => setHsn(t.replace(/\D/g, ''))} maxLength={8} keyboardType="number-pad"
          placeholder={tr('common.optional')} error={show('hsn')} hint={tr('settings.taxes_AddClassSheet.printed_on_tax_invoices')} />
      </FieldRow>
      {effectiveMode === 'library' && preset ? (
        <SettingSwitch title={tr('settings.taxes_AddClassSheet.follow_the_brand_gst_library', { brand: brand.name })} value={follow} onValueChange={setFollow}
          subtitle={tr('settings.taxes_AddClassSheet.recommended_when_the_government_changes')} />
      ) : null}
    </Sheet>
  );
}
