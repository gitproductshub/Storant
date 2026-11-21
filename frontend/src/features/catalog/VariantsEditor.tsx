import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { Button, Chip, IconButton, Input, Text } from '@/components/ui';
import { VARIANT_PRESETS, localKey, sanitizeMoney } from './utils';
import { t as tr } from '@/i18n';

export interface VariantDraft { key: string; id?: string; name: string; price: string }
export type VariantErrors = Record<string, { name?: string; price?: string }>;

export const MAX_VARIANTS = 20;

export function VariantsEditor({ variants, onChange, errors, symbol, compact }: {
  variants: VariantDraft[]; onChange: (v: VariantDraft[]) => void; errors: VariantErrors; symbol: string; compact?: boolean;
}) {
  const { colors } = useTheme();
  const update = (key: string, patch: Partial<VariantDraft>) => onChange(variants.map((v) => (v.key === key ? { ...v, ...patch } : v)));
  const remove = (key: string) => onChange(variants.filter((v) => v.key !== key));
  const add = (name = '') => {
    if (variants.length >= MAX_VARIANTS) return;
    onChange([...variants, { key: localKey('v'), name, price: '' }]);
  };
  const applyPreset = (names: string[]) => {
    // Keep prices the owner already typed for options with the same name
    const byName = new Map(variants.map((v) => [v.name.trim().toLowerCase(), v]));
    onChange(names.map((n) => byName.get(n.toLowerCase()) ?? { key: localKey('v'), name: n, price: '' }));
  };

  return (
    <View style={{ gap: 10 }}>
      {variants.length === 0 ? (
        <Text variant="small" tone="muted">
          {tr('catalog.VariantsEditor.add_options_when_one_item_is_sold_in')}
        </Text>
      ) : (
        <View style={{ gap: 8 }}>
          {variants.map((v, i) => {
            const err = errors[v.key];
            return (
              <View key={v.key} style={styles.row}>
                <Input
                  containerStyle={{ flex: 1.4 }}
                  placeholder={i === 0 ? tr('catalog.VariantsEditor.e_g_half') : tr('catalog.VariantsEditor.option_name')}
                  value={v.name}
                  onChangeText={(t) => update(v.key, { name: t })}
                  error={err?.name}
                  maxLength={40}
                  accessibilityLabel={tr('catalog.VariantsEditor.option_v_name', { v: i + 1 })}
                />
                <Input
                  containerStyle={{ flex: 1 }}
                  placeholder="0"
                  prefix={symbol}
                  value={v.price}
                  onChangeText={(t) => update(v.key, { price: sanitizeMoney(t) })}
                  keyboardType="decimal-pad"
                  error={err?.price}
                  accessibilityLabel={tr('catalog.VariantsEditor.option_v_price', { v: i + 1 })}
                />
                <IconButton icon="close" accessibilityLabel={tr('catalog.VariantsEditor.remove_option_v', { v: v.name || i + 1 })} onPress={() => remove(v.key)} />
              </View>
            );
          })}
        </View>
      )}
      <View style={[styles.presets, compact && { gap: 6 }]}>
        <Button title={tr('catalog.VariantsEditor.add_option')} icon="add" size="sm" variant="secondary" onPress={() => add()} disabled={variants.length >= MAX_VARIANTS} />
        {VARIANT_PRESETS.map((p) => (
          <Chip key={p.label} label={p.label} icon="flash-outline" onPress={() => applyPreset(p.names)} />
        ))}
      </View>
      {variants.length >= MAX_VARIANTS ? <Text variant="small" tone="warning">{tr('catalog.VariantsEditor.you_can_add_up_to_max_variants_options', { MAX_VARIANTS })}</Text> : null}
      {variants.length > 0 ? (
        <View style={[styles.note, { backgroundColor: colors.infoSoft }]}>
          <Text variant="small" tone="info">{tr('catalog.VariantsEditor.prices_are_the_full_selling_price_of_each')}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  note: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
});
