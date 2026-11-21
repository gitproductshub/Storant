import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { BusinessSettings, MenuScanResult } from '@/api/types';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { Button, Card, Chip, Input, SwitchRow, Text, toast } from '@/components/ui';
import { promptTop } from '../dialogs';
import { Checkbox, ChoiceChips, Collapsible, Field } from '../components';
import { GST_RATES, normName, plural, trimRate } from '../utils';
import { LOW_CONFIDENCE, blankRow, duplicateKeys, rowProblems, type ReviewRow } from './review';
import { ReviewHeader, ReviewRowItem } from './ReviewRowItem';
import { t } from '@/i18n';

type Filter = 'all' | 'attention' | 'existing' | 'low' | 'selected';

export interface ImportOptions { taxRate: number | null; printToKitchen: boolean; applyVeg: boolean }

interface Props {
  rows: ReviewRow[];
  setRows: React.Dispatch<React.SetStateAction<ReviewRow[]>>;
  scan: MenuScanResult | null;
  settings: BusinessSettings | null;
  options: ImportOptions;
  setOptions: (o: ImportOptions) => void;
  importing: boolean;
  onImport: () => void;
  onRescan: () => void;
}

export function ReviewStep({ rows, setRows, scan, settings, options, setOptions, importing, onImport, onRescan }: Props) {
  const { colors } = useTheme();
  const { isWide, isPhone } = useLayout();
  const symbol = settings?.currency_symbol || '₹';
  const defaultRate = settings?.default_tax_rate ?? 5;
  const food = settings?.business_type !== 'retail';
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');

  const dups = useMemo(() => duplicateKeys(rows), [rows]);
  const stats = useMemo(() => {
    let attention = 0, existing = 0, low = 0, selected = 0, blocked = 0;
    for (const r of rows) {
      const bad = rowProblems(r).length > 0;
      if (bad) attention += 1;
      if (r.existing) existing += 1;
      if (r.confidence !== null && r.confidence < LOW_CONFIDENCE) low += 1;
      if (r.include) {
        selected += 1;
        if (bad) blocked += 1;
      }
    }
    return { attention, existing, low, selected, blocked };
  }, [rows]);

  const visible = useMemo(() => {
    const q = normName(query);
    return rows.filter((r) => {
      if (filter === 'attention' && !(rowProblems(r).length > 0)) return false;
      if (filter === 'existing' && !r.existing) return false;
      if (filter === 'low' && !(r.confidence !== null && r.confidence < LOW_CONFIDENCE)) return false;
      if (filter === 'selected' && !r.include) return false;
      if (q && !normName(r.name).includes(q) && !normName(r.category).includes(q)) return false;
      return true;
    });
  }, [rows, filter, query]);

  const onChange = useCallback((key: string, patch: Partial<ReviewRow>) => {
    setRows((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }, [setRows]);
  const onRemove = useCallback((key: string) => setRows((list) => list.filter((r) => r.key !== key)), [setRows]);

  const visibleKeys = new Set(visible.map((r) => r.key));
  const visibleSelected = visible.filter((r) => r.include).length;
  const allChecked = visible.length > 0 && visibleSelected === visible.length;
  const someChecked = visibleSelected > 0 && !allChecked;
  const setAll = (on: boolean) => setRows((list) => list.map((r) => (visibleKeys.has(r.key) ? { ...r, include: on } : r)));

  const categories = useMemo(() => {
    const set = new Map<string, string>();
    for (const r of rows) if (r.category.trim()) set.set(normName(r.category), r.category.trim());
    return [...set.values()];
  }, [rows]);

  const bulkCategory = async () => {
    if (!stats.selected) return toast.info(t('catalog.scan_ReviewStep.tick_the_items_first'));
    const name = await promptTop({
      title: t('catalog.scan_ReviewStep.set_category_for_plural', { plural: plural(stats.selected, 'item') }),
      message: categories.length ? t('catalog.scan_ReviewStep.existing_join_v', { join: categories.slice(0, 8).join(', '), v: categories.length > 8 ? '…' : '' }) : undefined,
      label: t('catalog.scan_ReviewStep.category_name'),
      placeholder: food ? t('catalog.scan_ReviewStep.e_g_main_course') : t('catalog.scan_ReviewStep.e_g_snacks'),
      confirmLabel: t('common.apply'),
    });
    if (!name) return;
    const match = categories.find((c) => normName(c) === normName(name)) ?? name.trim().slice(0, 60);
    setRows((list) => list.map((r) => (r.include ? { ...r, category: match } : r)));
  };
  const bulkVeg = (veg: boolean | null) => {
    if (!stats.selected) return toast.info(t('catalog.scan_ReviewStep.tick_the_items_first'));
    setRows((list) => list.map((r) => (r.include ? { ...r, isVeg: veg } : r)));
    if (!options.applyVeg) setOptions({ ...options, applyVeg: true });
  };
  const addRow = () => {
    setFilter('all');
    setQuery('');
    setRows((list) => [...list, blankRow(list[list.length - 1]?.category ?? '')]);
  };

  const gstOptions = [{ value: null as number | null, label: t('catalog.scan_ReviewStep.default_trimrate', { trimRate: trimRate(defaultRate) }) }, ...GST_RATES.map((r) => ({ value: r as number | null, label: `${r}%` }))];
  const importable = stats.selected - stats.blocked;

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 24, gap: 16 }} keyboardShouldPersistTaps="handled">
        <Card style={{ gap: 12 }}>
          <View style={[styles.summary, !isWide && { flexDirection: 'column', alignItems: 'flex-start' }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: isWide ? 1 : undefined }}>
              <View style={[styles.icon, { backgroundColor: colors.successSoft }]}>
                <Ionicons name="sparkles" size={20} color={colors.success} />
              </View>
              <View style={{ flexShrink: 1 }}>
                <Text variant="h2">{scan ? t('catalog.scan_ReviewStep.found_plural', { plural: plural(scan.items.length, 'item') }) : t('catalog.scan_ReviewStep.type_your_items')}</Text>
                <Text variant="small" tone="muted">
                  {scan
                    ? t('catalog.scan_ReviewStep.plural_check_names_and_prices_then_import', { plural: plural(scan.categories.length, 'category', 'categories') })
                    : t('catalog.scan_ReviewStep.add_each_item_with_its_price_then_import')}
                </Text>
              </View>
            </View>
            <View style={styles.chips}>
              <Chip label={t('common.all')} count={rows.length} selected={filter === 'all'} onPress={() => setFilter('all')} />
              <Chip label={t('catalog.scan_ReviewStep.ticked')} count={stats.selected} selected={filter === 'selected'} onPress={() => setFilter('selected')} />
              {stats.attention ? <Chip label={t('catalog.scan_ReviewStep.needs_a_fix')} icon="alert-circle-outline" count={stats.attention} selected={filter === 'attention'} onPress={() => setFilter('attention')} /> : null}
              {stats.low ? <Chip label={t('catalog.scan_ReviewStep.low_confidence')} icon="eye-outline" count={stats.low} selected={filter === 'low'} onPress={() => setFilter('low')} /> : null}
              {stats.existing ? <Chip label={t('catalog.scan_ReviewStep.already_on_menu')} count={stats.existing} selected={filter === 'existing'} onPress={() => setFilter('existing')} /> : null}
            </View>
          </View>
          <View style={[styles.settings, { borderTopColor: colors.divider }, !isWide && { flexDirection: 'column' }]}>
            <Field label={t('catalog.scan_ReviewStep.gst_for_these_items')} style={isWide ? { flex: 1.4 } : undefined}>
              <ChoiceChips<number | null> value={options.taxRate} options={gstOptions} onChange={(v) => setOptions({ ...options, taxRate: v })} />
            </Field>
            <View style={isWide ? { flex: 1 } : undefined}>
              <SwitchRow title={t('catalog.scan_ReviewStep.send_to_kitchen_kot')} value={options.printToKitchen} onValueChange={(v) => setOptions({ ...options, printToKitchen: v })} />
              {food ? (
                <SwitchRow title={t('catalog.scan_ReviewStep.save_veg_non_veg_marks')} subtitle={t('catalog.scan_ReviewStep.guessed_from_names_tap_a_row_s_mark_to')}
                  value={options.applyVeg} onValueChange={(v) => setOptions({ ...options, applyVeg: v })} />
              ) : null}
            </View>
          </View>
        </Card>

        {scan && scan.warnings.length ? (
          <Collapsible title={t('catalog.scan_ReviewStep.things_to_check')} icon="warning-outline" tone="warning" count={scan.warnings.length} defaultOpen={scan.items.length < 3}>
            {scan.warnings.map((w, i) => <Text key={i} variant="small" tone="warning">• {w}</Text>)}
          </Collapsible>
        ) : null}

        <Card padded={false} style={{ overflow: 'hidden' }}>
          <View style={[styles.toolbar, { borderBottomColor: colors.border }]}>
            <Checkbox checked={allChecked} indeterminate={someChecked} onChange={(v) => setAll(v)} label={allChecked ? t('catalog.scan_ReviewStep.untick_all_shown_items') : t('catalog.scan_ReviewStep.tick_all_shown_items')} />
            <Text variant="smallStrong" tone="muted" style={{ marginRight: 4 }}>{stats.selected} {t('catalog.scan_ReviewStep.ticked_2')}</Text>
            <Input icon="search" placeholder={t('catalog.scan_ReviewStep.search')} value={query} onChangeText={setQuery} containerStyle={{ flex: 1, minWidth: 160 }} accessibilityLabel={t('catalog.scan_ReviewStep.search_scanned_items')} />
            <View style={styles.bulk}>
              <Button title={isPhone ? t('common.category') : t('catalog.scan_ReviewStep.set_category')} icon="folder-outline" size="sm" variant="secondary" onPress={bulkCategory} disabled={!stats.selected} />
              {food ? <Button title={t('common.veg')} size="sm" variant="secondary" onPress={() => bulkVeg(true)} disabled={!stats.selected} accessibilityLabel={t('catalog.scan_ReviewStep.mark_ticked_items_veg')} /> : null}
              {food ? <Button title={t('catalog.scan_ReviewStep.non_veg')} size="sm" variant="secondary" onPress={() => bulkVeg(false)} disabled={!stats.selected} accessibilityLabel={t('catalog.scan_ReviewStep.mark_ticked_items_non_veg')} /> : null}
              <Button title={t('common.add_item')} icon="add" size="sm" variant="soft" onPress={addRow} />
            </View>
          </View>
          {isWide ? <ReviewHeader showVeg={food && options.applyVeg} /> : null}
          {visible.length === 0 ? (
            <View style={{ padding: 28, alignItems: 'center', gap: 10 }}>
              <Text tone="muted" align="center">{rows.length ? t('catalog.scan_ReviewStep.no_items_match_this_filter') : t('catalog.scan_ReviewStep.no_items_yet')}</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {rows.length ? <Button title={t('common.show_all')} variant="secondary" onPress={() => { setFilter('all'); setQuery(''); }} /> : null}
                <Button title={t('common.add_item')} icon="add" onPress={addRow} />
              </View>
            </View>
          ) : (
            visible.map((r, i) => (
              <ReviewRowItem
                key={r.key}
                row={r}
                index={i}
                wide={isWide}
                symbol={symbol}
                showVeg={food && options.applyVeg}
                duplicate={r.include && dups.has(normName(r.name))}
                onChange={onChange}
                onRemove={onRemove}
              />
            ))
          )}
          <View style={{ padding: 12 }}>
            <Button title={t('catalog.scan_ReviewStep.add_another_item')} icon="add" variant="ghost" onPress={addRow} />
          </View>
        </Card>

        {scan && scan.lines.length ? (
          <Collapsible title={t('catalog.scan_ReviewStep.text_we_read_raw')} icon="document-text-outline" count={scan.lines.length}>
            <Text variant="small" tone="muted">{t('catalog.scan_ReviewStep.useful_to_spot_items_the_scanner_missed')}</Text>
            <View style={[styles.raw, { backgroundColor: colors.surfaceSunken }]}>
              {scan.lines.map((l, i) => <Text key={i} variant="small" style={styles.mono} selectable>{l}</Text>)}
            </View>
          </Collapsible>
        ) : null}
        <Button title={t('catalog.scan_ReviewStep.scan_different_photos')} icon="camera-outline" variant="ghost" onPress={onRescan} style={{ alignSelf: 'center' }} />
      </ScrollView>

      <View style={[styles.footer, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
        <View style={{ flex: 1, minWidth: 0 }}>
          {stats.blocked ? (
            <Text variant="smallStrong" tone="danger" numberOfLines={2}>
              {plural(stats.blocked, 'ticked item')} {stats.blocked === 1 ? 'needs' : 'need'} {t('catalog.scan_ReviewStep.a_fix_usually_a_missing_price')}{' '}
              <Text variant="smallStrong" tone="primary" onPress={() => setFilter('attention')} accessibilityRole="link">{t('common.show')}</Text>
            </Text>
          ) : (
            <Text variant="small" tone="muted" numberOfLines={2}>
              {importable ? t('catalog.scan_ReviewStep.plural_will_be_added_v', { plural: plural(importable, 'item'), v: stats.existing ? t('catalog.scan_ReviewStep.items_already_on_your_menu_are_skipped') : '.' }) : t('catalog.scan_ReviewStep.tick_the_items_you_want_to_add')}
            </Text>
          )}
        </View>
        <Button
          title={importable ? t('catalog.scan_ReviewStep.import_plural', { plural: plural(importable, 'item') }) : t('catalog.scan_ReviewStep.import')}
          icon="cloud-upload-outline"
          size="lg"
          onPress={onImport}
          loading={importing}
          disabled={importing || !importable || stats.blocked > 0}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  summary: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  settings: { flexDirection: 'row', gap: 16, borderTopWidth: 1, paddingTop: 12 },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8, borderBottomWidth: 1, flexWrap: 'wrap' },
  bulk: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', alignItems: 'center', flexShrink: 1, maxWidth: '100%' },
  raw: { borderRadius: 10, padding: 12, gap: 2 },
  mono: { fontFamily: 'monospace' },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderRadius: 14, marginBottom: 8 },
});
