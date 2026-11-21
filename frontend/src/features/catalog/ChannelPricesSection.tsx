/**
 * Item editor section: price and availability of this item on each delivery app / online channel.
 * Empty price = the channel's mark-up over the counter price (shown as the placeholder).
 */
import React from 'react';
import { StyleSheet, Switch, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { SalesChannel } from '@/api/types';
import { useTheme } from '@/theme/ThemeProvider';
import { Button, IconButton, Input, Text } from '@/components/ui';
import { FormSection } from './components';
import {
  type ChannelDraft, type ChannelDraftEntry, channelShortName, draftEntry, formatPct, markupPlaceholder,
} from './channelPricing';
import { money } from '@/lib/format';
import { moneyInput, parseMoney, sanitizeMoney } from './utils';
import { t as tr } from '@/i18n';

type IconName = keyof typeof Ionicons.glyphMap;

const ICONS: Record<string, IconName> = {
  SWIGGY: 'bicycle-outline', ZOMATO: 'restaurant-outline', ONDC: 'globe-outline', MAGICPIN: 'sparkles-outline',
  ONLINE: 'storefront-outline', QR: 'qr-code-outline',
};

export function channelIcon(code: string): IconName {
  return ICONS[code] ?? 'cart-outline';
}

/** "Swiggy ₹289 · Not on Zomato" — the collapsed section's subtitle. */
function summary(channels: SalesChannel[], draft: ChannelDraft, symbol: string): string {
  const parts: string[] = [];
  for (const c of channels) {
    const e = draftEntry(draft, c.code);
    const n = channelShortName(c);
    if (!e.available) parts.push(`Not on ${n}`);
    else {
      const p = parseMoney(e.price);
      if (p !== null) parts.push(`${n} ${money(p, symbol, Number.isInteger(p))}`);
    }
  }
  if (!parts.length) return 'Same menu everywhere · each app’s mark-up applies';
  return parts.length > 3 ? `${parts.slice(0, 3).join(' · ')} · +${parts.length - 3} more` : parts.join(' · ');
}

export function ChannelPricesSection({ channels, draft, onChange, counterPrice, hasVariants, symbol, errors, open, onToggle, compact }: {
  channels: SalesChannel[];
  draft: ChannelDraft;
  onChange: (code: string, patch: Partial<ChannelDraftEntry>) => void;
  /** Counter price (lowest option price for items with options); null while the price field is empty */
  counterPrice: number | null;
  hasVariants: boolean;
  symbol: string;
  errors: Record<string, string>;
  open: boolean;
  onToggle: () => void;
  compact: boolean;
}) {
  const { colors } = useTheme();
  if (!channels.length) return null;
  return (
    <FormSection title={tr('catalog.ChannelPricesSection.prices_on_delivery_apps_online')} icon="bicycle-outline" subtitle={summary(channels, draft, symbol)}
      right={<Button title={open ? tr('common.hide') : tr('common.edit')} size="sm" variant="ghost" iconRight={open ? 'chevron-up' : 'chevron-down'} onPress={onToggle}
        accessibilityLabel={tr('catalog.ChannelPricesSection.v_prices_on_delivery_apps', { v: open ? tr('common.hide') : tr('common.edit') })} />}>
      {open ? (
        <View style={{ gap: 10 }}>
          <Text variant="small" tone="muted">
            {tr('catalog.ChannelPricesSection.leave_a_price_empty_to_use_the_app_s_mark')}
            {hasVariants ? tr('catalog.ChannelPricesSection.options_sizes_keep_their_extra_cost_on') : ''}
          </Text>
          {channels.map((c) => {
            const entry = draftEntry(draft, c.code);
            const name = channelShortName(c);
            const typed = parseMoney(entry.price);
            const pct = Number(c.price_adjust_pct) || 0;
            const canMatchCounter = entry.available && counterPrice !== null && (typed !== null ? typed !== counterPrice : pct !== 0);
            const toggle = (
              <View style={styles.switchWrap}>
                <Text variant="small" tone="muted">{compact ? tr('catalog.ChannelPricesSection.on_menu') : tr('catalog.ChannelPricesSection.on_this_menu')}</Text>
                <Switch value={entry.available} onValueChange={(v) => onChange(c.code, { available: v })}
                  accessibilityLabel={tr('catalog.ChannelPricesSection.name_on_this_menu', { name: c.name })} trackColor={{ true: colors.primary, false: colors.borderStrong }} />
              </View>
            );
            const info = (
              <View style={[styles.head, compact ? { flex: 1 } : { width: 170 }]}>
                <View style={[styles.icon, { backgroundColor: entry.available ? colors.primarySoft : colors.surfaceSunken }]}>
                  <Ionicons name={channelIcon(c.code)} size={16} color={entry.available ? colors.primarySoftText : colors.textMuted} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text variant="bodyStrong" numberOfLines={1}>{name}</Text>
                  <Text variant="caption" tone="subtle" numberOfLines={1}>{pct ? tr('catalog.ChannelPricesSection.formatpct_mark_up', { formatPct: formatPct(pct) }) : tr('catalog.ChannelPricesSection.no_mark_up')}</Text>
                </View>
              </View>
            );
            const price = entry.available ? (
              <View style={styles.priceCol}>
                <Input
                  containerStyle={{ flex: 1 }}
                  prefix={symbol}
                  keyboardType="decimal-pad"
                  value={entry.price}
                  onChangeText={(t) => onChange(c.code, { price: sanitizeMoney(t) })}
                  placeholder={markupPlaceholder(counterPrice, c, symbol)}
                  error={errors[c.code]}
                  accessibilityLabel={tr('catalog.ChannelPricesSection.v_on_name', { v: hasVariants ? tr('catalog.ChannelPricesSection.base_price') : tr('common.price'), name: c.name })}
                  right={entry.price ? (
                    <IconButton icon="close-circle" accessibilityLabel={tr('catalog.ChannelPricesSection.use_name_s_mark_up_instead', { name })} onPress={() => onChange(c.code, { price: '' })} />
                  ) : undefined}
                />
                {canMatchCounter ? (
                  <Button title={tr('common.same_as_counter')} size="sm" variant="ghost" onPress={() => onChange(c.code, { price: moneyInput(counterPrice) })}
                    accessibilityLabel={tr('catalog.ChannelPricesSection.set_the_name_price_to_the_counter_price', { name: c.name })} />
                ) : null}
              </View>
            ) : (
              <View style={[styles.priceCol, { minHeight: 46 }]}>
                <Ionicons name="eye-off-outline" size={16} color={colors.textSubtle} />
                <Text variant="small" tone="muted" style={{ flex: 1 }}>{tr('catalog.ChannelPricesSection.hidden_from_name_orders_from_name_can_t', { name })}</Text>
              </View>
            );
            return (
              <View key={c.code} style={[styles.row, { borderColor: colors.border, backgroundColor: entry.available ? colors.surface : colors.surfaceAlt },
                compact && styles.rowCompact]}>
                {compact ? (
                  <>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>{info}{toggle}</View>
                    {price}
                  </>
                ) : (
                  <>{info}{price}{toggle}</>
                )}
              </View>
            );
          })}
        </View>
      ) : null}
    </FormSection>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 12, padding: 10 },
  rowCompact: { flexDirection: 'column', alignItems: 'stretch', gap: 8 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  icon: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  switchWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  priceCol: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
});
