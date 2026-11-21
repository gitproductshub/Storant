import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { catalogApi } from '@/api/endpoints';
import { errorMessage } from '@/api/client';
import type { Category, Product } from '@/api/types';
import { useTheme } from '@/theme/ThemeProvider';
import { Button, EmptyState, IconButton, Input, Sheet, Text, toast } from '@/components/ui';
import { confirmTop } from './dialogs';
import { plural } from './utils';
import { t as tr } from '@/i18n';

interface Props {
  visible: boolean;
  onClose: () => void;
  categories: Category[]; // active, sorted
  products: Product[];
  onCategories: (items: Category[]) => void;
  onDropCategory: (id: string) => void;
  onProducts: (items: Product[]) => void;
  onReload: () => void;
}

/** Rename, reorder (up/down) and delete categories. New categories are added from the rail/chips. */
export function CategoryManagerSheet({ visible, onClose, categories, products, onCategories, onDropCategory, onProducts, onReload }: Props) {
  const { colors } = useTheme();
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; name: string; error?: string } | null>(null);
  const [newName, setNewName] = useState('');
  const [newError, setNewError] = useState<string | null>(null);

  const countFor = (id: string) => products.filter((p) => p.is_active && p.category_id === id).length;

  const add = async () => {
    const name = newName.trim();
    if (!name) return setNewError('Enter a name.');
    if (name.length > 60) return setNewError('Keep it under 60 characters.');
    if (categories.some((c) => c.name.trim().toLowerCase() === name.toLowerCase())) return setNewError('This category already exists.');
    setBusy('new');
    try {
      const cat = await catalogApi.createCategory(name);
      const withOrder = categories.length && cat.sort_order <= categories[categories.length - 1]!.sort_order
        ? await catalogApi.updateCategory(cat.id, { sort_order: categories[categories.length - 1]!.sort_order + 1 }).catch(() => cat)
        : cat;
      onCategories([withOrder]);
      setNewName('');
      setNewError(null);
      toast.success(tr('common.added_name', { name }));
    } catch (e) {
      setNewError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const saveRename = async () => {
    if (!editing) return;
    const name = editing.name.trim();
    if (!name) return setEditing({ ...editing, error: tr('catalog.CategoryManagerSheet.enter_a_name') });
    if (name.length > 60) return setEditing({ ...editing, error: tr('catalog.CategoryManagerSheet.keep_it_under_60_characters') });
    if (categories.some((c) => c.id !== editing.id && c.name.trim().toLowerCase() === name.toLowerCase())) {
      return setEditing({ ...editing, error: tr('catalog.CategoryManagerSheet.another_category_has_this_name') });
    }
    const current = categories.find((c) => c.id === editing.id);
    if (current && current.name === name) return setEditing(null);
    setBusy(editing.id);
    try {
      const updated = await catalogApi.updateCategory(editing.id, { name });
      onCategories([updated]);
      setEditing(null);
    } catch (e) {
      setEditing({ ...editing, error: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };

  const move = async (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= categories.length) return;
    const order = [...categories];
    const [item] = order.splice(index, 1);
    order.splice(target, 0, item!);
    // Renumber so ties (all 0 for older data) can't keep the old order
    const changed = order.map((c, i) => ({ ...c, sort_order: i })).filter((c, i) => categories.find((x) => x.id === c.id)?.sort_order !== i);
    onCategories(changed);
    setBusy(item!.id);
    try {
      const saved = await Promise.all(changed.map((c) => catalogApi.updateCategory(c.id, { sort_order: c.sort_order })));
      onCategories(saved);
    } catch (e) {
      toast.error(errorMessage(e));
      onReload();
    } finally {
      setBusy(null);
    }
  };

  const remove = async (cat: Category) => {
    const count = countFor(cat.id);
    const ok = await confirmTop({
      title: tr('catalog.CategoryManagerSheet.delete_name', { name: cat.name }),
      message: count
        ? tr('catalog.CategoryManagerSheet.plural_in_this_category_will_stay_on_your', { plural: plural(count, 'item') })
        : tr('catalog.CategoryManagerSheet.this_category_has_no_items'),
      confirmLabel: tr('catalog.CategoryManagerSheet.delete_category'),
      danger: true,
    });
    if (!ok) return;
    setBusy(cat.id);
    try {
      await catalogApi.deleteCategory(cat.id);
      onDropCategory(cat.id);
      // Detach its products so they show as uncategorised everywhere (POS, online menu)
      const members = products.filter((p) => p.category_id === cat.id);
      const updated: Product[] = [];
      let failed = 0;
      for (let i = 0; i < members.length; i += 5) {
        const batch = await Promise.allSettled(members.slice(i, i + 5).map((p) => catalogApi.updateProduct(p.id, { category_id: null })));
        for (const r of batch) {
          if (r.status === 'fulfilled') updated.push(r.value);
          else failed += 1;
        }
      }
      onProducts(updated);
      toast.success(tr('catalog.CategoryManagerSheet.deleted_name', { name: cat.name }));
      if (failed) toast.warning(tr('catalog.CategoryManagerSheet.plural_could_not_be_moved_to', { plural: plural(failed, 'item') }));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={tr('catalog.CategoryManagerSheet.categories')} subtitle={tr('catalog.CategoryManagerSheet.rename_reorder_or_delete_order_here_is')} width={560}
      footer={<View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}><Button title={tr('common.done')} onPress={onClose} /></View>}>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
        <Input
          containerStyle={{ flex: 1 }}
          placeholder={tr('catalog.CategoryManagerSheet.new_category_e_g_starters')}
          value={newName}
          onChangeText={(t) => { setNewName(t); setNewError(null); }}
          onSubmitEditing={add}
          error={newError}
          maxLength={60}
          accessibilityLabel={tr('catalog.CategoryManagerSheet.new_category_name')}
          returnKeyType="done"
        />
        <Button title={tr('common.add')} icon="add" onPress={add} loading={busy === 'new'} disabled={!!busy && busy !== 'new'} />
      </View>
      {categories.length === 0 ? (
        <EmptyState icon="folder-open-outline" title={tr('catalog.CategoryManagerSheet.no_categories_yet')} message={tr('catalog.CategoryManagerSheet.group_your_items_e_g_starters_main_course')} />
      ) : (
        <View style={[styles.list, { borderColor: colors.border }]}>
          {categories.map((c, i) => {
            const isEditing = editing?.id === c.id;
            const rowBusy = busy === c.id;
            return (
              <View key={c.id} style={[styles.row, i > 0 && { borderTopWidth: 1, borderTopColor: colors.divider }]}>
                {isEditing ? (
                  <View style={{ flex: 1, flexDirection: 'row', gap: 6, alignItems: 'flex-start' }}>
                    <Input
                      containerStyle={{ flex: 1 }}
                      value={editing.name}
                      autoFocus
                      maxLength={60}
                      onChangeText={(t) => setEditing({ id: c.id, name: t })}
                      onSubmitEditing={saveRename}
                      error={editing.error}
                      accessibilityLabel={tr('catalog.CategoryManagerSheet.rename_name', { name: c.name })}
                    />
                    <IconButton icon="checkmark" variant="primary" accessibilityLabel={tr('catalog.CategoryManagerSheet.save_name')} onPress={saveRename} disabled={rowBusy} />
                    <IconButton icon="close" accessibilityLabel={tr('catalog.CategoryManagerSheet.cancel_rename')} onPress={() => setEditing(null)} />
                  </View>
                ) : (
                  <>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text variant="bodyStrong" numberOfLines={1}>{c.name}</Text>
                      <Text variant="small" tone="muted">{plural(countFor(c.id), 'item')}</Text>
                    </View>
                    <IconButton icon="arrow-up" accessibilityLabel={tr('catalog.CategoryManagerSheet.move_name_up', { name: c.name })} disabled={i === 0 || !!busy} onPress={() => move(i, -1)} />
                    <IconButton icon="arrow-down" accessibilityLabel={tr('catalog.CategoryManagerSheet.move_name_down', { name: c.name })} disabled={i === categories.length - 1 || !!busy} onPress={() => move(i, 1)} />
                    <IconButton icon="pencil-outline" accessibilityLabel={tr('catalog.CategoryManagerSheet.rename_name', { name: c.name })} disabled={!!busy} onPress={() => setEditing({ id: c.id, name: c.name })} />
                    <IconButton icon="trash-outline" accessibilityLabel={tr('catalog.CategoryManagerSheet.delete_name_2', { name: c.name })} disabled={!!busy} onPress={() => remove(c)} />
                  </>
                )}
              </View>
            );
          })}
        </View>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  list: { borderWidth: 1, borderRadius: 12, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingLeft: 14, paddingRight: 4, paddingVertical: 6, minHeight: 56 },
});
