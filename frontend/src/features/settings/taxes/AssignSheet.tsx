/** Bulk-assign a tax class: pick the class, then whole categories, single items, or every item. */
import React, { useMemo, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { errorMessage } from '@/api/client';
import { formatRate, taxesApi, type TaxClass } from '@/api/taxes';
import type { Product } from '@/api/types';
import { Button, Chip, EmptyState, Input, Segmented, Sheet, Text, toast } from '@/components/ui';
import { Checkbox } from '@/features/catalog/components';
import { useData } from '@/store/data';
import { useTheme } from '@/theme/ThemeProvider';
import { Callout } from '../components';
import { t } from '@/i18n';

type Scope = 'categories' | 'items' | 'all';
const DEFAULT = '__default__';

export function AssignSheet({ classes, defaultClass, initialClassId, onClose, onDone }: {
  classes: TaxClass[]; defaultClass: TaxClass | null; initialClassId?: string | null; onClose: () => void; onDone: (updated: number) => void;
}) {
  const { colors } = useTheme();
  const products = useData((s) => s.products);
  const categories = useData((s) => s.categories);
  const items = useMemo(() => products.filter((p) => p.is_active).sort((a, b) => a.name.localeCompare(b.name)), [products]);
  const activeClasses = classes.filter((c) => c.is_active);
  const byId = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes]);

  const [target, setTarget] = useState<string>(initialClassId ?? activeClasses[0]?.id ?? DEFAULT);
  const [scope, setScope] = useState<Scope>('categories');
  const [cats, setCats] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [onlyUnassigned, setOnlyUnassigned] = useState(false);
  const [saving, setSaving] = useState(false);

  const countByCat = useMemo(() => {
    const m = new Map<string | null, number>();
    for (const p of items) m.set(p.category_id, (m.get(p.category_id) ?? 0) + 1);
    return m;
  }, [items]);
  const usedCategories = categories.filter((c) => (countByCat.get(c.id) ?? 0) > 0 || c.is_active);

  const classLabel = (p: Product): string => {
    if (p.tax_class_id) {
      const c = byId.get(p.tax_class_id);
      return c ? `${c.name} · ${formatRate(c.current_rate)}%` : 'Unknown class';
    }
    if (p.tax_rate !== null && p.tax_rate !== undefined) return `Legacy ${formatRate(p.tax_rate)}%`;
    return defaultClass ? `Default · ${formatRate(defaultClass.current_rate)}%` : 'Default';
  };

  const q = query.trim().toLowerCase();
  const visibleItems = items.filter((p) => (!onlyUnassigned || !p.tax_class_id) && (!q || p.name.toLowerCase().includes(q) || (p.barcode ?? '').includes(q)));

  const affected = scope === 'all' ? items.length
    : scope === 'categories' ? items.filter((p) => p.category_id && cats.has(p.category_id)).length
      : picked.size;
  const targetClass = target === DEFAULT ? null : byId.get(target) ?? null;
  const targetLabel = targetClass ? `${targetClass.name} (${formatRate(targetClass.current_rate)}%)` : `your business default${defaultClass ? ` (${defaultClass.name}, ${formatRate(defaultClass.current_rate)}%)` : ''}`;

  const toggle = (set: Set<string>, id: string, setter: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    setter(next);
  };

  const submit = async () => {
    if (!affected) return;
    setSaving(true);
    try {
      const res = await taxesApi.assign({
        tax_class_id: targetClass?.id ?? null,
        ...(scope === 'all' ? { all_products: true } : scope === 'categories' ? { category_ids: [...cats] } : { product_ids: [...picked] }),
      });
      toast.success(t('settings.taxes_AssignSheet.updated_item_v_now_use_v2', { updated: res.updated, v: res.updated === 1 ? '' : 's', v2: targetClass ? targetClass.name : t('settings.taxes_AssignSheet.the_default_class') }));
      onDone(res.updated);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const allVisiblePicked = visibleItems.length > 0 && visibleItems.every((p) => picked.has(p.id));

  return (
    <Sheet visible onClose={saving ? () => undefined : onClose} title={t('settings.taxes_AssignSheet.assign_tax_class')} width={680}
      subtitle={t('settings.taxes_AssignSheet.choose_a_class_then_the_items_it_applies')}
      footer={
        <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'wrap' }}>
          <Text variant="small" tone="muted" style={{ flex: 1, minWidth: 160 }}>
            {affected ? t('settings.taxes_AssignSheet.affected_item_v_will_use_targetlabel', { affected, v: affected === 1 ? '' : 's', targetLabel }) : t('settings.taxes_AssignSheet.nothing_selected_yet')}
          </Text>
          <Button title={t('common.cancel')} variant="secondary" onPress={onClose} disabled={saving} />
          <Button title={affected ? t('settings.taxes_AssignSheet.assign_to_affected_item_v', { affected, v: affected === 1 ? '' : 's' }) : t('settings.taxes_AssignSheet.assign')} icon="checkmark" onPress={submit} loading={saving} disabled={saving || !affected} />
        </View>
      }>
      <View style={{ gap: 8 }}>
        <Text variant="smallStrong" tone="muted">{t('settings.taxes_AssignSheet.1_tax_class')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Chip label={t('settings.taxes_AssignSheet.business_default_v', { v: defaultClass ? ` (${formatRate(defaultClass.current_rate)}%)` : '' })} selected={target === DEFAULT} onPress={() => setTarget(DEFAULT)} />
          {activeClasses.map((c) => (
            <Chip key={c.id} label={`${c.name} · ${formatRate(c.current_rate)}%`} selected={target === c.id} onPress={() => setTarget(c.id)} />
          ))}
        </View>
      </View>

      <View style={{ gap: 8 }}>
        <Text variant="smallStrong" tone="muted">{t('settings.taxes_AssignSheet.2_apply_to')}</Text>
        <Segmented<Scope> value={scope} onChange={setScope}
          options={[{ value: 'categories', label: t('settings.taxes_AssignSheet.categories'), icon: 'folder-outline' }, { value: 'items', label: t('common.items'), icon: 'list-outline' }, { value: 'all', label: t('settings.taxes_AssignSheet.all_items'), icon: 'apps-outline' }]} />
      </View>

      {!items.length ? (
        <EmptyState icon="fast-food-outline" title={t('settings.taxes_AssignSheet.no_items_yet')} message={t('settings.taxes_AssignSheet.add_items_to_your_menu_first_then_assign')} />
      ) : scope === 'all' ? (
        <Callout tone="warning" title={t('settings.taxes_AssignSheet.all_length_items_will_use_targetlabel', { length: items.length, targetLabel })}>
          {t('settings.taxes_AssignSheet.this_replaces_the_tax_class_of_every_item')}
        </Callout>
      ) : scope === 'categories' ? (
        <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, overflow: 'hidden' }}>
          {usedCategories.map((c, i) => {
            const n = countByCat.get(c.id) ?? 0;
            const on = cats.has(c.id);
            return (
              <Pressable key={c.id} onPress={() => toggle(cats, c.id, setCats)} accessibilityRole="checkbox" accessibilityState={{ checked: on }}
                style={({ hovered }: any) => [{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingRight: 14, minHeight: 48,
                  borderTopWidth: i ? 1 : 0, borderTopColor: colors.divider, backgroundColor: on ? colors.primarySoft : hovered ? colors.surfaceSunken : 'transparent' },
                Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}>
                <Checkbox checked={on} onChange={() => toggle(cats, c.id, setCats)} label={c.name} />
                <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>{c.name}</Text>
                <Text variant="small" tone="muted">{n} {t('common.item_2')}{n === 1 ? '' : 's'}</Text>
              </Pressable>
            );
          })}
          {!usedCategories.length ? <Text tone="muted" style={{ padding: 14 }}>{t('settings.taxes_AssignSheet.no_categories_use_items_instead')}</Text> : null}
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          <Input value={query} onChangeText={setQuery} placeholder={t('settings.taxes_AssignSheet.search_items')} icon="search" accessibilityLabel={t('settings.taxes_AssignSheet.search_items')} autoCorrect={false} />
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <Chip label={t('settings.taxes_AssignSheet.only_items_without_a_class')} icon="filter" selected={onlyUnassigned} onPress={() => setOnlyUnassigned((v) => !v)} />
            <Button title={allVisiblePicked ? t('settings.taxes_AssignSheet.clear_shown') : t('settings.taxes_AssignSheet.select_shown_length', { length: visibleItems.length })} size="sm" variant="ghost"
              onPress={() => {
                const next = new Set(picked);
                visibleItems.forEach((p) => (allVisiblePicked ? next.delete(p.id) : next.add(p.id)));
                setPicked(next);
              }} disabled={!visibleItems.length} />
            {picked.size ? <Text variant="small" tone="muted">{picked.size} {t('settings.taxes_AssignSheet.selected')}</Text> : null}
          </View>
          <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, overflow: 'hidden' }}>
            {visibleItems.slice(0, 300).map((p, i) => {
              const on = picked.has(p.id);
              return (
                <Pressable key={p.id} onPress={() => toggle(picked, p.id, setPicked)} accessibilityRole="checkbox" accessibilityState={{ checked: on }}
                  style={({ hovered }: any) => [{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingRight: 14, minHeight: 48,
                    borderTopWidth: i ? 1 : 0, borderTopColor: colors.divider, backgroundColor: on ? colors.primarySoft : hovered ? colors.surfaceSunken : 'transparent' },
                  Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}>
                  <Checkbox checked={on} onChange={() => toggle(picked, p.id, setPicked)} label={p.name} />
                  <Text variant="bodyStrong" style={{ flex: 1, minWidth: 0 }} numberOfLines={1}>{p.name}</Text>
                  <Text variant="small" tone={p.tax_class_id ? 'muted' : 'warning'} numberOfLines={1} style={{ maxWidth: 200 }}>{classLabel(p)}</Text>
                </Pressable>
              );
            })}
            {!visibleItems.length ? <Text tone="muted" style={{ padding: 14 }}>{t('settings.taxes_AssignSheet.no_items_match')}</Text> : null}
            {visibleItems.length > 300 ? <Text variant="small" tone="muted" style={{ padding: 14 }}>{t('settings.taxes_AssignSheet.showing_the_first_300_search_to_narrow')}</Text> : null}
          </View>
        </View>
      )}
    </Sheet>
  );
}
