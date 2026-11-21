import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, type Href } from 'expo-router';
import { catalogApi } from '@/api/endpoints';
import { ApiError, errorMessage } from '@/api/client';
import type { Brand, BusinessSettings, Category, Product, SalesChannel } from '@/api/types';
import { cachedTaxOverview, describeComponents, formatRate, loadTaxOverview, rememberTaxOverview, type TaxOverview } from '@/api/taxes';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { ActionMenu, Badge, Button, Chip, IconButton, Input, Segmented, SwitchRow, Text, toast, useHotkeys } from '@/components/ui';
import { DetailPanel } from './DetailPanel';
import { confirmTop } from './dialogs';
import { Barcode } from '@/components/Barcode';
import { money } from '@/lib/format';
import { isValidEan13 } from '@/lib/barcode/ean13';
import { isCode128Encodable } from '@/lib/barcode/code128';
import { ChoiceChips, Field, FormSection } from './components';
import { VariantsEditor, type VariantDraft, type VariantErrors } from './VariantsEditor';
import { BarcodeScanSheet } from './BarcodeScanSheet';
import { ChannelPricesSection } from './ChannelPricesSection';
import { ProductHistorySheet } from './ProductHistorySheet';
import {
  type ChannelDraft, channelDraftErrors, channelDraftFrom, channelPricesPayload, menuChannels, samePrices, setDraftEntry,
} from './channelPricing';
import { useData } from '@/store/data';
import {
  MAX_PRICE, UNITS, barcodeError, isFoodBusiness, kitchenDefault, moneyInput, normName, parseIntOrNull,
  parseMoney, sanitizeInt, sanitizeMoney,
} from './utils';
import { t as tr, currentLocale } from '@/i18n';

const TAX_DEFAULT = '';
const TAX_LEGACY = '__legacy__';

interface Draft {
  name: string;
  categoryId: string | null;
  price: string;
  /** Legacy per-item rate (kept only while no tax class is chosen) */
  taxRate: number | null;
  taxClassId: string | null;
  isVeg: boolean | null;
  description: string;
  variants: VariantDraft[];
  printToKitchen: boolean;
  trackStock: boolean;
  openingStock: string;
  lowStock: string;
  unit: string;
  sku: string;
  barcode: string;
  costPrice: string;
  brandId: string | null;
  /** Per delivery app / online channel: own price and "on this menu" (only entries that differ from the default) */
  channelPrices: ChannelDraft;
}

type Errors = Partial<Record<keyof Draft | 'form', string>>;

function draftFrom(p: Product | null, defaults: { categoryId: string | null; businessType: BusinessSettings['business_type'] | undefined }): Draft {
  if (!p) {
    return {
      name: '', categoryId: defaults.categoryId, price: '', taxRate: null, taxClassId: null, isVeg: null, description: '', variants: [],
      printToKitchen: kitchenDefault(defaults.businessType), trackStock: !isFoodBusiness(defaults.businessType), openingStock: '', lowStock: '',
      unit: 'pcs', sku: '', barcode: '', costPrice: '', brandId: null, channelPrices: {},
    };
  }
  return {
    name: p.name,
    categoryId: p.category_id,
    price: moneyInput(p.base_price),
    taxRate: p.tax_class_id ? null : p.tax_rate,
    taxClassId: p.tax_class_id ?? null,
    isVeg: p.is_veg,
    description: p.description ?? '',
    variants: p.variants.map((v) => ({ key: v.id, id: v.id, name: v.name, price: moneyInput(v.price) })),
    printToKitchen: p.print_to_kitchen,
    trackStock: p.track_stock,
    openingStock: '',
    lowStock: p.low_stock_threshold === null || p.low_stock_threshold === undefined ? '' : String(p.low_stock_threshold),
    unit: p.unit || 'pcs',
    sku: p.sku ?? '',
    barcode: p.barcode ?? '',
    costPrice: moneyInput(p.cost_price),
    brandId: p.brand_id,
    channelPrices: channelDraftFrom(p.channel_prices),
  };
}

export interface ProductEditorProps {
  product: Product | null;
  initialCategoryId: string | null;
  categories: Category[];
  products: Product[];
  brands: Brand[];
  settings: BusinessSettings | null;
  onClose: () => void;
  onSaved: (p: Product) => void;
  onDeleted: (id: string) => void;
  onCategoryCreated: (c: Category) => void;
  onPrintLabel: (p: Product) => void;
  /** Delivery apps / online channels that get their own price (default: enabled ones from the offline cache) */
  channels?: SalesChannel[];
  /** Shown in a narrow side panel: stack paired fields */
  narrow?: boolean;
}

export function ProductEditor(props: ProductEditorProps) {
  const { categories, products, brands, settings, onClose, onSaved, onDeleted, onCategoryCreated, onPrintLabel } = props;
  const { colors } = useTheme();
  const { isPhone: phone } = useLayout();
  // The editor is a side panel next to the list on tablets/desktops (narrow), full screen on phones: stack fields either way.
  const isPhone = phone || !!props.narrow;
  const symbol = settings?.currency_symbol || '₹';
  const food = isFoodBusiness(settings?.business_type);

  const [product, setProduct] = useState<Product | null>(props.product);
  const [initial] = useState<Draft>(() => draftFrom(props.product, { categoryId: props.initialCategoryId, businessType: settings?.business_type }));
  const [baseline, setBaseline] = useState<Draft>(initial);
  const [draft, setDraft] = useState<Draft>(initial);
  const [errors, setErrors] = useState<Errors>({});
  const [variantErrors, setVariantErrors] = useState<VariantErrors>({});
  const [busy, setBusy] = useState<null | 'save' | 'saveNew' | 'delete' | 'barcode' | 'restore' | 'category'>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [newCategory, setNewCategory] = useState<string | null>(null);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [more, setMore] = useState(() => !!(initial.sku || initial.barcode || initial.costPrice || initial.description || initial.brandId || !food));
  const savingRef = useRef(false);
  const cachedChannels = useData((s) => s.channels);
  const appChannels = props.channels ?? menuChannels(cachedChannels);
  const [appsOpen, setAppsOpen] = useState(() => appChannels.some((c) => !!initial.channelPrices[c.code]));
  // Tax classes change rarely: shared cache between editor openings (GET /taxes at most once a minute)
  const [tax, setTax] = useState<TaxOverview | null>(() => cachedTaxOverview(Infinity));
  const [taxError, setTaxError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    loadTaxOverview()
      .then((data) => {
        if (alive) { setTax(data); setTaxError(null); }
      })
      .catch((e) => { if (alive) setTaxError(errorMessage(e)); });
    return () => { alive = false; };
  }, []);

  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    if (errors[key] || errors.form) setErrors((e) => ({ ...e, [key]: undefined, form: undefined }));
  };

  const activeBrands = brands.filter((b) => b.is_active || b.id === draft.brandId);
  const hasVariants = draft.variants.length > 0;
  const priceNum = parseMoney(draft.price);
  const costNum = parseMoney(draft.costPrice);
  const sellFrom = hasVariants
    ? Math.min(...draft.variants.map((v) => parseMoney(v.price)).filter((n): n is number => n !== null))
    : priceNum;

  // --- validation ---
  const validate = (): boolean => {
    const e: Errors = {};
    const ve: VariantErrors = {};
    const name = draft.name.trim();
    if (!name) e.name = tr('catalog.ProductEditor.enter_the_item_name');
    else if (name.length > 120) e.name = tr('catalog.ProductEditor.keep_the_name_under_120_characters');
    else {
      const dup = products.find((p) => p.is_active && p.id !== product?.id && normName(p.name) === normName(name));
      if (dup) e.name = tr('catalog.ProductEditor.name_is_already_on_your_menu_use_a', { name: dup.name });
    }
    if (!hasVariants) {
      if (priceNum === null) e.price = tr('catalog.ProductEditor.enter_the_selling_price');
      else if (priceNum > MAX_PRICE) e.price = tr('common.price_is_too_high');
    } else {
      const seen = new Set<string>();
      for (const v of draft.variants) {
        const err: { name?: string; price?: string } = {};
        const n = v.name.trim();
        if (!n) err.name = tr('catalog.ProductEditor.name_required');
        else if (seen.has(n.toLowerCase())) err.name = tr('catalog.ProductEditor.duplicate_option');
        seen.add(n.toLowerCase());
        const p = parseMoney(v.price);
        if (p === null) err.price = tr('catalog.ProductEditor.price_required');
        else if (p > MAX_PRICE) err.price = tr('catalog.ProductEditor.too_high');
        if (err.name || err.price) ve[v.key] = err;
      }
    }
    if (costNum !== null && costNum > MAX_PRICE) e.costPrice = tr('catalog.ProductEditor.cost_is_too_high');
    const bErr = barcodeError(draft.barcode);
    if (bErr) e.barcode = bErr;
    else if (draft.barcode.trim()) {
      const clash = products.find((p) => p.is_active && p.id !== product?.id && p.barcode === draft.barcode.trim());
      if (clash) e.barcode = tr('catalog.ProductEditor.already_used_by_name', { name: clash.name });
    }
    if (draft.sku.trim().length > 48) e.sku = tr('catalog.ProductEditor.sku_can_be_at_most_48_characters');
    if (draft.description.length > 500) e.description = tr('catalog.ProductEditor.keep_the_description_under_500_characters');
    if (Object.keys(channelDraftErrors(draft.channelPrices)).length) {
      e.channelPrices = tr('catalog.ProductEditor.check_the_prices_on_delivery_apps');
      setAppsOpen(true);
    }
    setErrors(e);
    setVariantErrors(ve);
    const ok = Object.keys(e).length === 0 && Object.keys(ve).length === 0;
    if (!ok) {
      if ((e.sku || e.barcode || e.costPrice || e.description) && !more) setMore(true);
    }
    return ok;
  };

  const payload = (): Record<string, unknown> => {
    const variants = draft.variants.map((v) => ({ ...(v.id ? { id: v.id } : {}), name: v.name.trim(), price: parseMoney(v.price) ?? 0 }));
    const base = variants.length ? Math.min(...variants.map((v) => v.price)) : priceNum ?? 0;
    const body: Record<string, unknown> = {
      name: draft.name.trim(),
      description: draft.description.trim() || null,
      base_price: base,
      cost_price: costNum,
      tax_rate: draft.taxClassId ? null : draft.taxRate,
      category_id: draft.categoryId,
      is_veg: draft.isVeg,
      print_to_kitchen: draft.printToKitchen,
      track_stock: draft.trackStock,
      low_stock_threshold: draft.trackStock ? parseIntOrNull(draft.lowStock) : (product?.low_stock_threshold ?? null),
      unit: draft.unit || 'pcs',
      sku: draft.sku.trim() || null,
      barcode: draft.barcode.trim() || null,
      variants,
    };
    if (activeBrands.length || product?.brand_id) body.brand_id = draft.brandId;
    // Only send the class when it changed: the server rejects a class that was turned off since it was assigned.
    if (!product || draft.taxClassId !== (product.tax_class_id ?? null)) body.tax_class_id = draft.taxClassId;
    // Per-app prices: only when set / changed, so other devices' edits to them aren't overwritten by an unrelated save
    const channelPrices = channelPricesPayload(draft.channelPrices);
    if (product ? !samePrices(channelPrices, product.channel_prices) : Object.keys(channelPrices).length) body.channel_prices = channelPrices;
    if (!product && draft.trackStock) {
      const opening = parseIntOrNull(draft.openingStock);
      if (opening && opening > 0) body.opening_stock = opening;
    }
    return body;
  };

  const handleServerError = (e: unknown) => {
    if (e instanceof ApiError) {
      if (e.status === 409) return setErrors((x) => ({ ...x, barcode: e.message || 'Another product already uses this barcode.' }));
      if (e.status === 404 && /category/i.test(e.message)) return setErrors((x) => ({ ...x, categoryId: 'This category was deleted. Pick another one.' }));
      if (e.status === 404 && /brand/i.test(e.message)) return setErrors((x) => ({ ...x, brandId: 'This brand no longer exists.' }));
      if (e.status === 404 && /tax class/i.test(e.message)) {
        rememberTaxOverview(null);
        return setErrors((x) => ({ ...x, form: 'That tax class was turned off or removed. Pick another one.' }));
      }
      if (e.status === 422 && /channel/i.test(e.message)) return setErrors((x) => ({ ...x, form: e.message }));
      if (e.status === 422) return setErrors((x) => ({ ...x, form: 'Some values are not accepted. Check prices and codes and try again.' }));
    }
    setErrors((x) => ({ ...x, form: errorMessage(e) }));
    toast.error(errorMessage(e));
  };

  /** Saves the draft; resolves with the saved product (or null when invalid / failed). */
  const save = async (mode: 'save' | 'saveNew' | 'silent'): Promise<Product | null> => {
    if (savingRef.current) return null;
    if (!validate()) return null;
    savingRef.current = true;
    if (mode !== 'silent') setBusy(mode);
    try {
      const saved = product ? await catalogApi.updateProduct(product.id, payload()) : await catalogApi.createProduct(payload());
      onSaved(saved);
      if (mode === 'saveNew') {
        toast.success(tr('common.added_name', { name: saved.name }));
        const fresh = { ...draftFrom(null, { categoryId: draft.categoryId, businessType: settings?.business_type }), taxClassId: draft.taxClassId, taxRate: draft.taxClassId ? null : draft.taxRate, isVeg: draft.isVeg, printToKitchen: draft.printToKitchen };
        setProduct(null);
        setBaseline(fresh);
        setDraft(fresh);
        setErrors({});
        setVariantErrors({});
      } else {
        const next = draftFrom(saved, { categoryId: null, businessType: settings?.business_type });
        setProduct(saved);
        setBaseline(next);
        setDraft(next);
        if (mode === 'save') {
          toast.success(product ? tr('catalog.ProductEditor.changes_saved') : tr('common.added_name', { name: saved.name }));
          onClose();
        }
      }
      return saved;
    } catch (e) {
      handleServerError(e);
      return null;
    } finally {
      savingRef.current = false;
      setBusy(null);
    }
  };

  const generateBarcode = async () => {
    setBusy('barcode');
    try {
      let target = product;
      if (!target || dirty) {
        target = await save('silent');
        if (!target) {
          toast.warning(tr('catalog.ProductEditor.fix_the_highlighted_fields_first_the_item'));
          return;
        }
      }
      const updated = await catalogApi.generateBarcode(target.id);
      onSaved(updated);
      setProduct(updated);
      const next = draftFrom(updated, { categoryId: null, businessType: settings?.business_type });
      setBaseline(next);
      setDraft(next);
      toast.success(tr('catalog.ProductEditor.barcode_barcode_assigned', { barcode: updated.barcode }));
    } catch (e) {
      handleServerError(e);
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!product) return;
    const ok = await confirmTop({
      title: tr('catalog.ProductEditor.remove_name_from_the_menu', { name: product.name }),
      message: tr('catalog.ProductEditor.it_disappears_from_billing_and_every'),
      confirmLabel: tr('catalog.ProductEditor.remove_item'),
      danger: true,
    });
    if (!ok) return;
    setBusy('delete');
    try {
      await catalogApi.deleteProduct(product.id);
      onDeleted(product.id);
      toast.success(tr('catalog.ProductEditor.removed_name_from_the_menu', { name: product.name }));
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  /** History restore: the server saved it as a new version; take it as the new baseline. */
  const onVersionRestored = (saved: Product) => {
    onSaved(saved);
    setProduct(saved);
    const next = draftFrom(saved, { categoryId: null, businessType: settings?.business_type });
    setBaseline(next);
    setDraft(next);
    setErrors({});
    setVariantErrors({});
  };

  const restore = async () => {
    if (!product) return;
    setBusy('restore');
    try {
      // Recorded by the server as a new version ("Back on the menu")
      const saved = await catalogApi.updateProduct(product.id, { is_active: true });
      onSaved(saved);
      setProduct(saved);
      toast.success(tr('catalog.ProductEditor.name_is_back_on_the_menu', { name: saved.name }));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const createCategory = async () => {
    const name = (newCategory ?? '').trim();
    if (!name) return setCategoryError('Enter a name.');
    if (name.length > 60) return setCategoryError('Keep it under 60 characters.');
    const existing = categories.find((c) => normName(c.name) === normName(name));
    if (existing) {
      set('categoryId', existing.id);
      setNewCategory(null);
      return;
    }
    setBusy('category');
    try {
      const last = categories[categories.length - 1];
      let cat = await catalogApi.createCategory(name);
      if (last && cat.sort_order <= last.sort_order) cat = await catalogApi.updateCategory(cat.id, { sort_order: last.sort_order + 1 }).catch(() => cat);
      onCategoryCreated(cat);
      set('categoryId', cat.id);
      setNewCategory(null);
      setCategoryError(null);
    } catch (e) {
      setCategoryError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const close = async () => {
    if (busy) return;
    if (dirty) {
      const ok = await confirmTop({ title: tr('catalog.ProductEditor.discard_changes'), message: tr('catalog.ProductEditor.your_changes_to_this_item_have_not_been'), confirmLabel: tr('common.discard'), danger: true });
      if (!ok) return;
    }
    onClose();
  };

  const onScanned = (code: string) => {
    setScanOpen(false);
    set('barcode', code);
    const clash = products.find((p) => p.is_active && p.id !== product?.id && p.barcode === code);
    if (clash) setErrors((x) => ({ ...x, barcode: `Already used by “${clash.name}”.` }));
    else toast.success(tr('catalog.ProductEditor.scanned_code', { code }));
  };

  const barcodeValue = draft.barcode.trim();
  const previewFormat = isValidEan13(barcodeValue) ? 'ean13' : 'code128';
  const canPreview = !!barcodeValue && !barcodeError(barcodeValue) && (previewFormat === 'ean13' || isCode128Encodable(barcodeValue));
  const deleted = product ? !product.is_active : false;
  const margin = sellFrom !== null && Number.isFinite(sellFrom) && costNum !== null && sellFrom > 0 ? ((sellFrom - costNum) / sellFrom) * 100 : null;
  const pair = isPhone ? styles.stack : styles.pair;
  const anyBusy = busy !== null;
  const channelErrors = channelDraftErrors(draft.channelPrices);

  // --- tax class picker ---
  const taxClasses = tax?.classes ?? [];
  const defaultClass = taxClasses.find((c) => c.id === (tax?.default_tax_class_id ?? settings?.default_tax_class_id)) ?? null;
  const defaultRate = defaultClass?.current_rate ?? settings?.default_tax_rate ?? 5;
  const legacyRate = initial.taxClassId ? null : initial.taxRate;
  const taxValue = draft.taxClassId ?? (draft.taxRate !== null ? TAX_LEGACY : TAX_DEFAULT);
  const selectedClass = draft.taxClassId ? taxClasses.find((c) => c.id === draft.taxClassId) ?? null : null;
  const taxOptions: { value: string; label: string }[] = [
    { value: TAX_DEFAULT, label: tr('catalog.ProductEditor.business_default_formatrate', { formatRate: formatRate(defaultRate) }) },
    ...taxClasses
      .filter((c) => c.is_active || c.id === draft.taxClassId)
      .map((c) => ({ value: c.id, label: `${c.name} · ${formatRate(c.current_rate)}%${c.is_active ? '' : tr('catalog.ProductEditor.turned_off')}` })),
  ];
  if (draft.taxClassId && !selectedClass) taxOptions.push({ value: draft.taxClassId, label: tax ? tr('catalog.ProductEditor.removed_class') : tr('catalog.ProductEditor.current_class') });
  if (legacyRate !== null) taxOptions.push({ value: TAX_LEGACY, label: tr('catalog.ProductEditor.legacy_formatrate', { formatRate: formatRate(legacyRate) }) });
  const pickTax = (v: string) => {
    if (v === TAX_LEGACY) setDraft((d) => ({ ...d, taxClassId: null, taxRate: legacyRate }));
    else setDraft((d) => ({ ...d, taxClassId: v || null, taxRate: null }));
  };
  const nextChange = selectedClass?.rates.filter((r) => r.upcoming).sort((a, b) => a.effective_from.localeCompare(b.effective_from))[0];
  const taxHint = taxValue === TAX_LEGACY
    ? 'An old per-item rate. Pick a tax class so government rate changes apply to this item automatically.'
    : selectedClass
      ? [describeComponents(selectedClass.current_components, selectedClass.current_rate), selectedClass.hsn_sac ? `HSN/SAC ${selectedClass.hsn_sac}` : null,
        nextChange ? `changes to ${formatRate(nextChange.total_rate)}% on ${new Date(nextChange.effective_from).toLocaleDateString(currentLocale(), { day: 'numeric', month: 'short', year: 'numeric' })}` : null]
        .filter(Boolean).join(' · ')
      : `Uses your business default${defaultClass ? ` (${defaultClass.name})` : ''}. Changing the default later updates this item too.`;
  const units = UNITS.includes(draft.unit as (typeof UNITS)[number]) ? [...UNITS] : [draft.unit, ...UNITS];

  // Ctrl+S saves (desktop web)
  useHotkeys({ 'Ctrl+s': () => { if (!anyBusy && (!product || dirty)) void save('save'); } }, [anyBusy, product, dirty, draft]);

  const footer = (
    <View style={styles.footer}>
      {product && !deleted ? (
        <Button icon="trash-outline" variant="dangerOutline" onPress={remove} loading={busy === 'delete'} disabled={anyBusy}
          accessibilityLabel={tr('catalog.ProductEditor.remove_item_from_the_menu')} />
      ) : null}
      {product ? (
        <Button title={phone ? undefined : tr('catalog.ProductEditor.history')} icon="time-outline" variant="ghost" onPress={() => setHistoryOpen(true)} disabled={anyBusy}
          accessibilityLabel={tr('catalog.ProductEditor.item_history_and_earlier_versions')} />
      ) : null}
      <View style={{ flex: 1 }} />
      {!product ? (
        <Button title={phone ? tr('catalog.ProductEditor.save_new') : tr('catalog.ProductEditor.save_add_another')} variant="outline" onPress={() => void save('saveNew')} loading={busy === 'saveNew'} disabled={anyBusy} />
      ) : null}
      <Button title={product ? tr('common.save') : tr('common.add_item')} icon="checkmark" onPress={() => void save('save')} loading={busy === 'save'}
        disabled={anyBusy || (!!product && !dirty)} disabledReason={product && !dirty ? tr('catalog.ProductEditor.no_changes_yet_x') : undefined} shortcut="Ctrl+S" />
    </View>
  );

  return (
    <>
      <DetailPanel onClose={() => void close()} title={product ? product.name : tr('catalog.ProductEditor.new_item')}
        subtitle={product ? (deleted ? tr('catalog.ProductEditor.removed_from_the_menu') : tr('catalog.ProductEditor.edit_item')) : tr('catalog.ProductEditor.fill_in_the_basics_everything_else_is')}
        footer={footer} dismissable={!anyBusy} testID="product-editor">
        {deleted ? (
          <View style={[styles.banner, { backgroundColor: colors.warningSoft, borderColor: colors.warning }]}>
            <Text tone="warning" style={{ flex: 1 }}>{tr('catalog.ProductEditor.this_item_was_removed_from_the_menu_so_it')}</Text>
            <Button title={tr('catalog.ProductEditor.bring_back')} icon="refresh" size="sm" onPress={restore} loading={busy === 'restore'} disabled={anyBusy} />
          </View>
        ) : null}

        {errors.form ? (
          <View style={[styles.banner, { backgroundColor: colors.dangerSoft, borderColor: colors.danger }]}>
            <Text tone="danger" style={{ flex: 1 }}>{errors.form}</Text>
          </View>
        ) : null}

        <FormSection title={tr('catalog.ProductEditor.basics')} icon="fast-food-outline">
          <Input label={tr('catalog.ProductEditor.item_name')} required autoFocus={!product} placeholder={food ? tr('catalog.ProductEditor.e_g_paneer_butter_masala') : tr('catalog.ProductEditor.e_g_amul_butter_100_g')} value={draft.name}
            onChangeText={(t) => set('name', t)} error={errors.name} maxLength={120} returnKeyType="next" />
          <Field label={tr('common.category')} error={errors.categoryId}>
            {categories.length > 12 ? (
              // Big menus: a scrollable menu instead of dozens of chips
              <View style={styles.wrap}>
                <ActionMenu title={tr('common.category')} width={300}
                  items={[
                    { key: 'none', label: tr('common.no_category'), selected: draft.categoryId === null, onPress: () => set('categoryId', null) },
                    ...categories.map((c) => ({ key: c.id, label: c.name, selected: draft.categoryId === c.id, onPress: () => set('categoryId', c.id) })),
                  ]}
                  trigger={(open) => (
                    <Button title={categories.find((c) => c.id === draft.categoryId)?.name ?? tr('common.no_category')} icon="folder-open-outline" iconRight="chevron-down"
                      variant="outline" onPress={open} accessibilityLabel={tr('catalog.ProductEditor.choose_category')} />
                  )} />
                {newCategory === null ? <Chip label={tr('catalog.ProductEditor.new_category')} icon="add" onPress={() => { setNewCategory(''); setCategoryError(null); }} /> : null}
              </View>
            ) : (
              <View style={styles.wrap}>
                <Chip label={tr('common.none')} selected={draft.categoryId === null} onPress={() => set('categoryId', null)} />
                {categories.map((c) => (
                  <Chip key={c.id} label={c.name} selected={draft.categoryId === c.id} onPress={() => set('categoryId', c.id)} />
                ))}
                {newCategory === null ? <Chip label={tr('catalog.ProductEditor.new_category')} icon="add" onPress={() => { setNewCategory(''); setCategoryError(null); }} /> : null}
              </View>
            )}
            {newCategory !== null ? (
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
                <Input containerStyle={{ flex: 1 }} autoFocus placeholder={tr('catalog.ProductEditor.e_g_starters')} value={newCategory} maxLength={60}
                  onChangeText={(t) => { setNewCategory(t); setCategoryError(null); }} onSubmitEditing={createCategory} error={categoryError}
                  accessibilityLabel={tr('catalog.ProductEditor.new_category_name')} />
                <Button title={tr('catalog.ProductEditor.create')} onPress={createCategory} loading={busy === 'category'} disabled={anyBusy} />
                <IconButton icon="close" accessibilityLabel={tr('catalog.ProductEditor.cancel_new_category')} onPress={() => setNewCategory(null)} />
              </View>
            ) : null}
          </Field>
          <Field label={tr('catalog.ProductEditor.food_type')} hint={food ? tr('catalog.ProductEditor.shown_as_the_green_red_mark_on_bills_and') : tr('catalog.ProductEditor.only_needed_for_food_products')}>
            <Segmented<'veg' | 'nonveg' | 'none'>
              value={draft.isVeg === null ? 'none' : draft.isVeg ? 'veg' : 'nonveg'}
              onChange={(v) => set('isVeg', v === 'none' ? null : v === 'veg')}
              options={[{ value: 'veg', label: tr('common.veg') }, { value: 'nonveg', label: tr('catalog.ProductEditor.non_veg') }, { value: 'none', label: tr('common.not_set') }]}
            />
          </Field>
        </FormSection>

        <FormSection title={tr('catalog.ProductEditor.price_tax')} icon="pricetag-outline">
          <View style={pair}>
            {hasVariants ? (
              <Field label={tr('catalog.ProductEditor.selling_price')} style={{ flex: 1 }} hint={tr('catalog.ProductEditor.set_per_option_below_billing_asks_which')}>
                <View style={[styles.readonly, { backgroundColor: colors.surfaceSunken, borderColor: colors.border }]}>
                  <Text tone="muted">{sellFrom !== null && Number.isFinite(sellFrom) ? tr('catalog.ProductEditor.from_money', { money: money(sellFrom, symbol) }) : tr('catalog.ProductEditor.from_options')}</Text>
                </View>
              </Field>
            ) : (
              <Input label={tr('catalog.ProductEditor.selling_price')} required containerStyle={{ flex: 1 }} prefix={symbol} placeholder="0" keyboardType="decimal-pad"
                value={draft.price} onChangeText={(t) => set('price', sanitizeMoney(t))} error={errors.price}
                hint={settings ? (settings.prices_include_tax ? tr('catalog.ProductEditor.price_includes_gst') : tr('catalog.ProductEditor.gst_is_added_on_top_at_billing')) : undefined} />
            )}
            <Input label={tr('catalog.ProductEditor.cost_price')} containerStyle={{ flex: 1 }} prefix={symbol} placeholder={tr('common.optional')} keyboardType="decimal-pad"
              value={draft.costPrice} onChangeText={(t) => set('costPrice', sanitizeMoney(t))} error={errors.costPrice}
              hint={margin !== null ? tr('catalog.ProductEditor.margin_tofixed', { toFixed: margin.toFixed(1) }) : tr('catalog.ProductEditor.used_for_profit_and_stock_value')} />
          </View>
          <Field label={tr('catalog.ProductEditor.gst_tax_class')} hint={taxError && !tax ? tr('catalog.ProductEditor.couldn_t_load_tax_classes_taxerror_your', { taxError }) : taxHint}
            right={tax && tax.registration !== 'regular' ? <Badge label={tr('catalog.ProductEditor.gst_not_charged')} tone="neutral" /> : undefined}>
            <ChoiceChips<string> value={taxValue} options={taxOptions} onChange={pickTax} />
          </Field>
        </FormSection>

        <ChannelPricesSection
          channels={appChannels}
          draft={draft.channelPrices}
          onChange={(code, patch) => {
            setDraft((d) => ({ ...d, channelPrices: setDraftEntry(d.channelPrices, code, patch) }));
            if (errors.channelPrices || errors.form) setErrors((x) => ({ ...x, channelPrices: undefined, form: undefined }));
          }}
          counterPrice={sellFrom !== null && Number.isFinite(sellFrom) ? sellFrom : null}
          hasVariants={hasVariants}
          symbol={symbol}
          errors={channelErrors}
          open={appsOpen}
          onToggle={() => setAppsOpen((v) => !v)}
          compact={isPhone}
        />

        <FormSection title={tr('catalog.ProductEditor.options_sizes')} icon="layers-outline" subtitle={hasVariants ? tr('catalog.ProductEditor.length_option_v', { length: draft.variants.length, v: draft.variants.length === 1 ? '' : 's' }) : tr('common.optional')}>
          <VariantsEditor variants={draft.variants} onChange={(v) => { set('variants', v); setVariantErrors({}); }} errors={variantErrors} symbol={symbol} compact={isPhone} />
        </FormSection>

        <FormSection title={tr('catalog.ProductEditor.kitchen_stock')} icon="flame-outline">
          <SwitchRow title={tr('catalog.ProductEditor.send_to_kitchen_kot')} subtitle={tr('catalog.ProductEditor.prints_a_kitchen_ticket_shows_on_the')}
            value={draft.printToKitchen} onValueChange={(v) => set('printToKitchen', v)} />
          <SwitchRow title={tr('catalog.ProductEditor.track_stock')} subtitle={tr('catalog.ProductEditor.count_quantity_on_hand_and_warn_when_it')}
            value={draft.trackStock} onValueChange={(v) => set('trackStock', v)} />
          {draft.trackStock ? (
            <View style={{ gap: 14 }}>
              <View style={pair}>
                {!product ? (
                  <Input label={tr('catalog.ProductEditor.opening_stock')} containerStyle={{ flex: 1 }} placeholder="0" keyboardType="number-pad" value={draft.openingStock}
                    onChangeText={(t) => set('openingStock', sanitizeInt(t))} hint={tr('catalog.ProductEditor.quantity_you_have_right_now')} />
                ) : (
                  <Field label={tr('catalog.ProductEditor.stock_on_hand')} style={{ flex: 1 }}>
                    <Button title={tr('catalog.ProductEditor.add_or_adjust_in_inventory')} icon="cube-outline" variant="secondary" size="sm"
                      onPress={() => router.navigate('/inventory' as Href)} />
                  </Field>
                )}
                <Input label={tr('catalog.ProductEditor.low_stock_alert_at')} containerStyle={{ flex: 1 }} keyboardType="number-pad" value={draft.lowStock}
                  placeholder={settings ? String(settings.low_stock_default) : '10'} onChangeText={(t) => set('lowStock', sanitizeInt(t))}
                  hint={draft.lowStock ? undefined : tr('catalog.ProductEditor.blank_uses_your_default_v', { v: settings?.low_stock_default ?? 10 })} />
              </View>
              <Field label={tr('catalog.ProductEditor.unit')}>
                <ChoiceChips<string> value={draft.unit} options={units.map((u) => ({ value: u, label: u }))} onChange={(v) => set('unit', v)} />
              </Field>
            </View>
          ) : null}
        </FormSection>

        <FormSection title={tr('catalog.ProductEditor.codes_details')} icon="barcode-outline" subtitle={tr('catalog.ProductEditor.barcode_sku_brand_description')}
          right={<Button title={more ? tr('common.hide') : tr('common.show')} size="sm" variant="ghost" iconRight={more ? 'chevron-up' : 'chevron-down'} onPress={() => setMore((v) => !v)} />}>
          {more ? (
            <View style={{ gap: 14 }}>
              <Input
                label={tr('catalog.ProductEditor.barcode')}
                placeholder={tr('catalog.ProductEditor.scan_type_or_generate')}
                value={draft.barcode}
                onChangeText={(t) => set('barcode', t.replace(/[^0-9A-Za-z\-. ]/g, ''))}
                error={errors.barcode}
                maxLength={48}
                autoCapitalize="characters"
                autoCorrect={false}
                hint={tr('catalog.ProductEditor.a_usb_bluetooth_scanner_can_scan_straight')}
                right={<IconButton icon="scan-outline" accessibilityLabel={tr('catalog.ProductEditor.scan_barcode_with_camera')} onPress={() => setScanOpen(true)} />}
              />
              <View style={styles.barcodeActions}>
                <Button title={product && !dirty ? tr('catalog.ProductEditor.generate_barcode') : tr('catalog.ProductEditor.save_generate_barcode')} icon="sparkles-outline" size="sm" variant="soft"
                  onPress={generateBarcode} loading={busy === 'barcode'} disabled={anyBusy || !!barcodeValue}
                  accessibilityLabel={tr('catalog.ProductEditor.generate_an_in_store_barcode')} />
                {product && !dirty && product.is_active && product.barcode && product.barcode === barcodeValue ? (
                  <Button title={tr('catalog.ProductEditor.print_label')} icon="print-outline" size="sm" variant="secondary" onPress={() => onPrintLabel(product)} disabled={anyBusy} />
                ) : null}
                {barcodeValue ? <Text variant="small" tone="subtle">{tr('catalog.ProductEditor.clear_the_field_to_generate_a_new_one')}</Text> : (
                  <Text variant="small" tone="subtle">{tr('catalog.ProductEditor.for_loose_own_brand_items_without_a')}</Text>
                )}
              </View>
              {canPreview ? (
                <View style={[styles.preview, { borderColor: colors.border }]}>
                  <Barcode value={barcodeValue} format={previewFormat} height={54} width={240} />
                  <Badge label={previewFormat === 'ean13' ? tr('catalog.ProductEditor.ean_13') : tr('catalog.ProductEditor.code_128')} tone="neutral" />
                </View>
              ) : null}
              <View style={pair}>
                <Input label={tr('catalog.ProductEditor.sku_item_code')} containerStyle={{ flex: 1 }} placeholder={tr('common.optional')} value={draft.sku} maxLength={48}
                  onChangeText={(t) => set('sku', t)} error={errors.sku} autoCapitalize="characters" autoCorrect={false} />
                <View style={{ flex: 1 }} />
              </View>
              {activeBrands.length ? (
                <Field label={tr('catalog.ProductEditor.brand')} hint={tr('catalog.ProductEditor.for_multi_brand_kitchens_which_brand')} error={errors.brandId}>
                  <ChoiceChips<string | null> value={draft.brandId} onChange={(v) => set('brandId', v)}
                    options={[{ value: null, label: tr('catalog.ProductEditor.all_brands') }, ...activeBrands.map((b) => ({ value: b.id as string | null, label: b.name }))]} />
                </Field>
              ) : null}
              <Input label={tr('common.description')} placeholder={tr('catalog.ProductEditor.shown_on_the_online_menu_e_g_cottage')} value={draft.description}
                onChangeText={(t) => set('description', t)} error={errors.description} multiline maxLength={500}
                style={{ minHeight: 72, textAlignVertical: 'top' }} hint={`${draft.description.length}/500`} />
            </View>
          ) : null}
        </FormSection>
      </DetailPanel>
      <BarcodeScanSheet visible={scanOpen} onClose={() => setScanOpen(false)} onScanned={onScanned} />
      {historyOpen && product ? (
        <ProductHistorySheet product={product} onClose={() => setHistoryOpen(false)} onRestored={onVersionRestored} categories={categories}
          channels={cachedChannels} symbol={symbol} unsaved={dirty} />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  footer: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pair: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  stack: { flexDirection: 'column', gap: 14 },
  readonly: { minHeight: 46, borderWidth: 1, borderRadius: 10, justifyContent: 'center', paddingHorizontal: 12 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 12, padding: 12 },
  barcodeActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginTop: -4 },
  preview: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 12, padding: 12, alignSelf: 'flex-start' },
});
