/**
 * "Set app prices": pick a delivery app / online channel, then give the selected items their own price there
 * (+X% over the counter price) or clear their own prices so the channel's mark-up applies again.
 */
import React, { useMemo, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { channelsApi } from '@/api/channels';
import { errorMessage } from '@/api/client';
import type { Category, Product, SalesChannel } from '@/api/types';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { Badge, Button, Chip, Input, Segmented, Sheet, SwitchRow, Text, toast } from '@/components/ui';
import { money } from '@/lib/format';
import { Checkbox, Field } from './components';
import {
  bulkMarkup, channelQuote, channelShortName, entryOf, formatPct, isOnChannel, markupPrice, withChannelPrice,
} from './channelPricing';
import { plural } from './utils';
import { t as tr } from '@/i18n';

type Mode = 'markup' | 'clear';

/** Safe defaults: a mark-up never overwrites prices someone typed by hand; clearing picks the items that have one. */
function defaultSelection(products: Product[], code: string | undefined, mode: Mode): Set<string> {
  if (!code) return new Set();
  return new Set(products.filter((p) => {
    const own = typeof entryOf(p.channel_prices, code).price === 'number';
    return mode === 'clear' ? own : isOnChannel(p, code) && !own;
  }).map((p) => p.id));
}

interface Plan { product: Product; before: number; after: number; changed: boolean }

export function ChannelPricesBulkSheet({ visible, onClose, channels, initialCode, products, categories, symbol, onProducts }: {
  visible: boolean;
  onClose: () => void;
  channels: SalesChannel[];
  initialCode: string | null;
  /** Active items */
  products: Product[];
  categories: Category[];
  symbol: string;
  onProducts: (saved: Product[]) => void;
}) {
  const { colors } = useTheme();
  const { isPhone } = useLayout();
  const [code, setCode] = useState<string>(() => (channels.find((c) => c.code === initialCode) ?? channels[0])?.code ?? '');
  const channel = channels.find((c) => c.code === code) ?? null;
  const [mode, setMode] = useState<Mode>('markup');
  const [pct, setPct] = useState(() => {
    const p = Number(channel?.price_adjust_pct) || 0;
    return String(p > 0 ? p : 10);
  });
  const [round, setRound] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(() => defaultSelection(products, channel?.code, 'markup'));
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);

  const categoryName = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);
  const pctNum = Number(pct);
  const pctError = mode === 'markup' && (pct.trim() === '' || !Number.isFinite(pctNum) || pctNum < -90 || pctNum > 300) ? 'Use -90 to 300.' : null;
  const name = channel ? channelShortName(channel) : '';

  const plans = useMemo<Plan[]>(() => {
    if (!channel) return [];
    return products.map((p) => {
      const before = channelQuote(p, channel).price;
      const own = entryOf(p.channel_prices, channel.code).price;
      let after: number;
      let changed: boolean;
      if (mode === 'clear') {
        after = markupPrice(p.base_price, channel.price_adjust_pct);
        changed = typeof own === 'number';
      } else {
        after = pctError ? before : bulkMarkup(p.base_price, pctNum, round);
        changed = !pctError && own !== after;
      }
      return { product: p, before, after, changed };
    });
  }, [products, channel, mode, pctNum, pctError, round]);

  const pickChannel = (next: string) => {
    setCode(next);
    setSelected(defaultSelection(products, next, mode));
  };
  const pickMode = (next: Mode) => {
    setMode(next);
    setSelected(defaultSelection(products, code, next));
  };

  const toApply = plans.filter((x) => x.changed && selected.has(x.product.id));
  const allOn = products.length > 0 && selected.size === products.length;
  const toggle = (id: string, on: boolean) => setSelected((s) => {
    const n = new Set(s);
    if (on) n.add(id); else n.delete(id);
    return n;
  });

  const apply = async () => {
    if (!channel || !toApply.length || busy) return;
    setBusy(true);
    setProgress(0);
    const saved: Product[] = [];
    const failed: { name: string; error: string }[] = [];
    const queue = [...toApply];
    let done = 0;
    // A few at a time: fast on a big menu without flooding a slow connection
    const worker = async () => {
      for (let job = queue.shift(); job; job = queue.shift()) {
        const next = withChannelPrice(job.product.channel_prices, channel.code, mode === 'clear' ? null : job.after);
        try {
          saved.push(await channelsApi.setProductPrices(job.product.id, next));
        } catch (e) {
          failed.push({ name: job.product.name, error: errorMessage(e) });
        }
        done += 1;
        setProgress(done);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    onProducts(saved);
    setBusy(false);
    if (failed.length) {
      toast.error(tr('catalog.ChannelPricesBulkSheet.plural_not_saved_name_error_try_again', { plural: plural(failed.length, 'item'), name: failed[0].name, error: failed[0].error }));
      return;
    }
    toast.success(mode === 'clear'
      ? tr('catalog.ChannelPricesBulkSheet.plural_now_use_name_s_mark_up', { plural: plural(saved.length, 'item'), name })
      : tr('catalog.ChannelPricesBulkSheet.set_name_prices_for_plural', { name, plural: plural(saved.length, 'item') }));
    onClose();
  };

  const footer = (
    <View style={styles.footer}>
      <Text variant="small" tone="muted" style={{ flex: 1, minWidth: 140 }}>
        {busy ? tr('catalog.ChannelPricesBulkSheet.saving_progress_of_length', { progress, length: toApply.length }) : toApply.length ? tr('catalog.ChannelPricesBulkSheet.plural_will_change', { plural: plural(toApply.length, 'item') }) : tr('catalog.ChannelPricesBulkSheet.nothing_to_change_for_the_selected_items')}
      </Text>
      {isPhone ? null : <Button title={tr('common.cancel')} variant="secondary" onPress={onClose} disabled={busy} />}
      <Button title={mode === 'clear' ? tr('catalog.ChannelPricesBulkSheet.clear_app_prices') : tr('catalog.ChannelPricesBulkSheet.set_name_prices', { name })} icon="checkmark" onPress={apply} loading={busy}
        disabled={busy || !toApply.length || !!pctError} />
    </View>
  );

  return (
    <Sheet visible={visible} onClose={onClose} title={tr('catalog.ChannelPricesBulkSheet.set_app_prices')} subtitle={tr('catalog.ChannelPricesBulkSheet.give_items_their_own_price_on_a_delivery')}
      width={760} footer={footer} scroll={false} dismissable={!busy}>
      <View style={{ gap: 14, flexShrink: 1, minHeight: 0 }}>
        <Field label={tr('common.channel')}>
          <View style={styles.wrap}>
            {channels.map((c) => <Chip key={c.code} label={channelShortName(c)} selected={c.code === code} onPress={() => pickChannel(c.code)} />)}
          </View>
        </Field>
        <Segmented<Mode> value={mode} onChange={pickMode} options={[
          { value: 'markup', label: isPhone ? tr('catalog.ChannelPricesBulkSheet.over_counter') : tr('catalog.ChannelPricesBulkSheet.add_over_counter_price'), icon: 'trending-up-outline' },
          { value: 'clear', label: isPhone ? tr('catalog.ChannelPricesBulkSheet.clear_prices') : tr('catalog.ChannelPricesBulkSheet.clear_own_prices'), icon: 'refresh-outline' },
        ]} />
        {mode === 'markup' ? (
          <View style={[styles.pair, isPhone && { flexDirection: 'column', alignItems: 'stretch' }]}>
            <Input label={tr('catalog.ChannelPricesBulkSheet.increase')} containerStyle={{ width: isPhone ? undefined : 160 }} value={pct} keyboardType="numbers-and-punctuation" maxLength={6}
              onChangeText={(t) => setPct(t.replace(/[^\d.-]/g, ''))} error={pctError} right={<Text tone="muted" style={{ paddingRight: 12 }}>%</Text>}
              accessibilityLabel={tr('catalog.ChannelPricesBulkSheet.percent_over_the_counter_price')} />
            <View style={{ flex: 1 }}>
              <SwitchRow title={tr('catalog.ChannelPricesBulkSheet.round_to_whole_rupees')} subtitle={tr('catalog.ChannelPricesBulkSheet.e_g_money_v_money2', { money: money(249, symbol, true), v: pctError ? '10' : pct, money2: money(bulkMarkup(249, pctError ? 10 : pctNum, round), symbol, round) })}
                value={round} onValueChange={setRound} />
            </View>
          </View>
        ) : (
          <Text variant="small" tone="muted">
            {tr('catalog.ChannelPricesBulkSheet.selected_items_go_back_to_name_s', { name })} {channel && Number(channel.price_adjust_pct) ? tr('catalog.ChannelPricesBulkSheet.formatpct_mark_up', { formatPct: formatPct(channel.price_adjust_pct) }) : tr('catalog.ChannelPricesBulkSheet.counter_price_no_mark_up')}{tr('catalog.ChannelPricesBulkSheet.hidden_shown_on_name_stays_as_it_is', { name })}
          </Text>
        )}
        <Text variant="small" tone="subtle">
          {mode === 'markup' ? tr('catalog.ChannelPricesBulkSheet.items_that_already_have_their_own_name', { name }) : ''}{tr('catalog.ChannelPricesBulkSheet.items_with_options_keep_each_option_s')}
        </Text>

        <View style={[styles.list, { borderColor: colors.border }]}>
          <View style={[styles.listHead, { backgroundColor: colors.surfaceAlt, borderBottomColor: colors.border }]}>
            <Checkbox checked={allOn} indeterminate={!allOn && selected.size > 0} label={tr('catalog.ChannelPricesBulkSheet.select_all_items')}
              onChange={(v) => setSelected(v ? new Set(products.map((p) => p.id)) : new Set())} />
            <Text variant="smallStrong" tone="muted" style={{ flex: 1 }}>{selected.size} {tr('catalog.ChannelPricesBulkSheet.of_plural_selected', { plural: plural(products.length, 'item') })}</Text>
            <Text variant="caption" tone="subtle">{name.toUpperCase()} {tr('catalog.ChannelPricesBulkSheet.price')}</Text>
          </View>
          <FlatList
            data={plans}
            keyExtractor={(x) => x.product.id}
            style={{ flexGrow: 0 }}
            renderItem={({ item }) => {
              const on = selected.has(item.product.id);
              const hidden = channel ? !isOnChannel(item.product, channel.code) : false;
              const cat = item.product.category_id ? categoryName.get(item.product.category_id) : null;
              return (
                <View style={[styles.item, { borderBottomColor: colors.divider }]}>
                  <Checkbox checked={on} onChange={(v) => toggle(item.product.id, v)} label={tr('catalog.ChannelPricesBulkSheet.include_name', { name: item.product.name })} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text variant="body" numberOfLines={1}>{item.product.name}</Text>
                    <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                      <Text variant="caption" tone="subtle" numberOfLines={1}>{[cat, `counter ${money(item.product.base_price, symbol)}`].filter(Boolean).join(' · ')}</Text>
                      {hidden ? <Badge label={tr('catalog.ChannelPricesBulkSheet.not_on_name', { name })} tone="warning" /> : null}
                      {channel && typeof entryOf(item.product.channel_prices, channel.code).price === 'number' ? <Badge label={tr('catalog.ChannelPricesBulkSheet.own_price')} tone="primary" /> : null}
                    </View>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    {item.changed && on ? (
                      <>
                        <Text variant="money" tone="primary">{money(item.after, symbol)}</Text>
                        <Text variant="caption" tone="subtle" style={{ textDecorationLine: 'line-through' }}>{money(item.before, symbol)}</Text>
                      </>
                    ) : (
                      <Text variant="money" tone={on ? 'default' : 'subtle'}>{money(item.before, symbol)}</Text>
                    )}
                  </View>
                </View>
              );
            }}
          />
        </View>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  footer: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pair: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  list: { borderWidth: 1, borderRadius: 12, overflow: 'hidden', flexShrink: 1, minHeight: 160 },
  listHead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingRight: 14, borderBottomWidth: 1, minHeight: 44 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingRight: 14, paddingVertical: 4, borderBottomWidth: 1, minHeight: 52 },
});
