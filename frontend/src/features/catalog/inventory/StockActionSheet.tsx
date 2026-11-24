import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { inventoryApi } from '@/api/endpoints';
import { errorMessage } from '@/api/client';
import type { StockRow } from '@/api/types';
import { useTheme } from '@/theme/ThemeProvider';
import { Button, Input, Segmented, Sheet, Text, toast } from '@/components/ui';
import { money } from '@/lib/format';
import { ChoiceChips, Field } from '../components';
import { moneyInput, parseIntOrNull, parseMoney, sanitizeInt, sanitizeMoney } from '../utils';
import { t as tr } from '@/i18n';

export type StockAction = 'restock' | 'wastage' | 'adjust';

const WASTE_REASONS = ['Expired', 'Damaged', 'Spilled / spoiled', 'Staff meal', 'Other'] as const;

export function StockActionSheet({ row, action, symbol, onClose, onDone }: {
  row: StockRow; action: StockAction; symbol: string; onClose: () => void; onDone: () => void;
}) {
  const { colors } = useTheme();
  const [qty, setQty] = useState('');
  const [cost, setCost] = useState(moneyInput(row.cost_price));
  const [note, setNote] = useState('');
  const [wasteReason, setWasteReason] = useState<string>('Expired');
  const [adjustMode, setAdjustMode] = useState<'count' | 'delta'>('count');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const n = parseIntOrNull(qty);
  let change: number | null = null;
  if (action === 'restock') change = n !== null && n > 0 ? n : null;
  else if (action === 'wastage') change = n !== null && n > 0 ? -n : null;
  else if (adjustMode === 'count') change = n !== null && n >= 0 ? n - row.stock : null;
  else change = n !== null && n !== 0 ? n : null;
  const counting = action === 'adjust' && adjustMode === 'count';
  const uncounted = row.counted === false; // its first count starts the stock counter, even at the same number
  const after = change !== null ? row.stock + change : null;

  const title = { restock: 'Add stock', wastage: 'Record wastage', adjust: 'Adjust stock' }[action];
  const unit = row.unit || 'pcs';

  const submit = async () => {
    setError(null);
    if (n === null || qty.trim() === '' || qty === '-') return setError(tr('catalog.inventory_StockActionSheet.enter_a_quantity'));
    if (change === null) {
      return setError(action === 'adjust' && adjustMode === 'delta' ? tr('catalog.inventory_StockActionSheet.enter_a_number_other_than_0_use_to_remove') : tr('catalog.inventory_StockActionSheet.quantity_must_be_more_than_0'));
    }
    if (change === 0 && !(counting && uncounted)) return setError(tr('catalog.inventory_StockActionSheet.that_matches_the_current_stock_nothing_to'));
    const unitCost = action === 'restock' ? parseMoney(cost) : null;
    const parts: string[] = [];
    if (action === 'wastage') parts.push(wasteReason);
    if (action === 'adjust' && adjustMode === 'count') parts.push(`Counted ${n} (was ${row.stock})`);
    if (note.trim()) parts.push(note.trim());
    setBusy(true);
    try {
      // Set count goes to the server as the counted number (it works out the difference itself, under a lock)
      const res = counting
        ? await inventoryApi.count({ product_id: row.id, quantity: n, note: parts.join(' · ').slice(0, 200) || undefined })
        : await inventoryApi.adjust({
          product_id: row.id,
          quantity: change,
          reason: action === 'restock' ? 'restock' : action === 'wastage' ? 'wastage' : 'adjustment',
          note: parts.join(' · ').slice(0, 200) || undefined,
          ...(unitCost !== null ? { unit_cost: unitCost } : {}),
        });
      toast.success(`${row.name}: ${uncounted ? '—' : row.stock} → ${res.stock ?? after} ${unit}`);
      onDone();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible onClose={busy ? () => {} : onClose} title={title} subtitle={row.name} width={480} dismissable={!busy}
      footer={
        <View style={styles.footer}>
          <Button title={tr('common.cancel')} variant="secondary" onPress={onClose} disabled={busy} />
          <Button title={title} variant={action === 'wastage' ? 'danger' : 'primary'} onPress={submit} loading={busy}
            disabled={busy || change === null || (change === 0 && !(counting && uncounted))} />
        </View>
      }>
      <View style={[styles.now, { backgroundColor: colors.surfaceSunken }]}>
        <View style={{ flex: 1 }}>
          <Text variant="small" tone="muted">{tr('catalog.inventory_StockActionSheet.in_stock_now')}</Text>
          <Text variant="h2">{uncounted ? tr('inventory.not_counted') : `${row.stock} ${unit}`}</Text>
        </View>
        {after !== null && change !== 0 ? (
          <View style={{ alignItems: 'flex-end' }}>
            <Text variant="small" tone="muted">{tr('catalog.inventory_StockActionSheet.after')}</Text>
            <Text variant="h2" tone={after < 0 ? 'danger' : after <= row.low_stock_threshold ? 'warning' : 'success'}>{after} {unit}</Text>
          </View>
        ) : null}
      </View>

      {action === 'adjust' ? (
        <Segmented<'count' | 'delta'> value={adjustMode} onChange={(v) => { setAdjustMode(v); setQty(''); setError(null); }}
          options={[{ value: 'count', label: tr('catalog.inventory_StockActionSheet.set_counted_quantity') }, { value: 'delta', label: tr('catalog.inventory_StockActionSheet.add_remove') }]} />
      ) : null}

      <Input
        label={action === 'restock' ? tr('catalog.inventory_StockActionSheet.quantity_received_unit', { unit }) : action === 'wastage' ? tr('catalog.inventory_StockActionSheet.quantity_wasted_unit', { unit }) : adjustMode === 'count' ? tr('catalog.inventory_StockActionSheet.counted_quantity_unit', { unit }) : tr('catalog.inventory_StockActionSheet.change_unit_use_to_remove', { unit })}
        required
        autoFocus
        keyboardType={action === 'adjust' && adjustMode === 'delta' ? 'numbers-and-punctuation' : 'number-pad'}
        placeholder={action === 'adjust' && adjustMode === 'delta' ? tr('catalog.inventory_StockActionSheet.e_g_2_or_5') : '0'}
        value={qty}
        onChangeText={(t) => { setQty(sanitizeInt(t, action === 'adjust' && adjustMode === 'delta')); setError(null); }}
        onSubmitEditing={submit}
        error={error}
        hint={
          action === 'adjust' && adjustMode === 'count' && change !== null
            ? change === 0 ? tr('catalog.inventory_StockActionSheet.matches_current_stock') : tr('catalog.inventory_StockActionSheet.difference_v_change_unit', { v: change > 0 ? '+' : '', change, unit })
            : action === 'wastage' && n !== null && n > row.stock ? tr('catalog.inventory_StockActionSheet.more_than_what_is_in_stock_stock_will_go') : undefined
        }
      />

      {action === 'restock' ? (
        <Input label={tr('catalog.inventory_StockActionSheet.cost_per_unit')} prefix={symbol} placeholder={tr('common.optional')} keyboardType="decimal-pad" value={cost}
          onChangeText={(t) => setCost(sanitizeMoney(t))}
          hint={parseMoney(cost) !== null && n ? tr('catalog.inventory_StockActionSheet.total_money_updates_the_item_s_cost_price', { money: money((parseMoney(cost) ?? 0) * n, symbol) }) : tr('catalog.inventory_StockActionSheet.updates_the_item_s_cost_price_for_stock')} />
      ) : null}

      {action === 'wastage' ? (
        <Field label={tr('common.reason')}>
          <ChoiceChips<string> value={wasteReason} onChange={setWasteReason} options={WASTE_REASONS.map((r) => ({ value: r, label: r }))} />
        </Field>
      ) : null}

      <Input label={tr('catalog.inventory_StockActionSheet.note')} placeholder={action === 'restock' ? tr('catalog.inventory_StockActionSheet.e_g_supplier_bill_no') : action === 'wastage' ? tr('catalog.inventory_StockActionSheet.optional_details') : tr('catalog.inventory_StockActionSheet.e_g_monthly_stock_count')}
        value={note} onChangeText={setNote} maxLength={120} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  footer: { flexDirection: 'row', gap: 10, justifyContent: 'flex-end' },
  now: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, padding: 14, gap: 12 },
});
