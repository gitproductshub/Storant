/**
 * Item picker of the billing screen: search (barcode scanners type into it), category chips and the items as
 * a grid of fixed-size tiles or a compact list with a quick +/- stepper. Both are virtualised with fixed row
 * heights, so a 300-item menu scrolls smoothly. On desktop the arrow keys move a highlight and Enter adds it.
 */
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Platform, Pressable, ScrollView, StyleSheet, TextInput, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Category, ChannelCode, Product } from '@/api/types';
import { Chip, EmptyState, IconButton, ShortcutHint, Text, VegMark, useHotkeys, useShowShortcuts } from '@/components/ui';
import { isTypingTarget } from '@/hooks/useHotkeys';
import { useTheme } from '@/theme/ThemeProvider';
import { fonts } from '@/theme/tokens';
import { money } from '@/lib/format';
import { unitPriceFor } from '@/lib/billing';
import { matchesQuery } from './totals';
import { stockMark, type StockMark } from '@/lib/stock';
import { gridMetrics, listMetrics, moveHighlight, rowLayout, scrollToReveal, type Direction, type ProductView } from './posLayout';
import { t } from '@/i18n';

export interface ProductBrowserProps {
  products: Product[];
  categories: Category[];
  query: string;
  onQueryChange: (q: string) => void;
  /** Enter in the search box, with the input's live text (fast scanners can beat React state) and the highlighted item. */
  onSubmitSearch: (text: string, highlighted: Product | null) => void;
  onPick: (p: Product) => void;
  /** One less of this item (list stepper). */
  onDecrement: (p: Product) => void;
  inCart: Map<string, number>;
  currency: string;
  adjustPct: number;
  /** Sales channel of the bill: per-item channel prices show on the tiles. */
  channel?: ChannelCode;
  searchRef: React.RefObject<TextInput | null>;
  onScan: () => void;
  autoFocusSearch: boolean;
  compact: boolean;
  view: ProductView;
  onViewChange: (v: ProductView) => void;
  /** Arrow keys / Enter move through and add items (desktop web, nothing else open). */
  keyboard: boolean;
  /** Extra buttons on the right of the search bar (dense = narrow pane). */
  actions?: (dense: boolean) => React.ReactNode;
  /** Shown instead of the grid when there is no menu at all. */
  emptyMenu: React.ReactNode;
  bottomInset?: number;
  header?: React.ReactNode;
  /** Sold-out items are refused here (Inventory on, selling at zero not allowed): their tiles grey out */
  stockBlocking?: boolean;
  /** Business alert level for "N left" (items without their own) */
  lowStockDefault?: number;
}

export function ProductBrowser(props: ProductBrowserProps) {
  const {
    products, categories, query, onQueryChange, onSubmitSearch, onPick, onDecrement, inCart, currency, adjustPct, channel = 'POS', searchRef, onScan,
    autoFocusSearch, actions, emptyMenu, bottomInset = 0, header, view, onViewChange, keyboard, stockBlocking = false, lowStockDefault = 10,
  } = props;
  const { colors, radius } = useTheme();
  const finePointer = useShowShortcuts();
  const [category, setCategory] = useState<string | null>(null);
  const [width, setWidth] = useState(0);
  const [focused, setFocused] = useState(false);
  // Narrow pane (phone, or tablet portrait next to the cart): denser tiles and a shorter search hint
  const compact = props.compact || (width > 0 && width < 560);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of products) if (p.category_id) m.set(p.category_id, (m.get(p.category_id) ?? 0) + 1);
    return m;
  }, [products]);
  const visibleCats = useMemo(() => categories.filter((c) => counts.get(c.id)), [categories, counts]);
  const catIndex = useMemo(() => new Map(visibleCats.map((c, i) => [c.id, i])), [visibleCats]);
  const activeCategory = category && counts.get(category) ? category : null;

  const q = query.trim();
  const filtered = useMemo(() => {
    if (q) return products.filter((p) => matchesQuery(p, q));
    return activeCategory ? products.filter((p) => p.category_id === activeCategory) : products;
  }, [products, q, activeCategory]);

  const grid = gridMetrics(width, compact);
  const list = listMetrics(width, finePointer);
  const isGrid = view === 'grid';
  const columns = isGrid ? grid.columns : list.columns;
  const pad = isGrid ? grid.pad : list.pad;
  const rowSpan = isGrid ? grid.tileHeight + grid.gap : list.rowHeight;

  // ---------------------------------------------------------------- keyboard highlight
  // -1 = nothing highlighted. Typing a search highlights the first match so Enter adds it.
  const [hl, setHl] = useState(-1);
  const [kbActive, setKbActive] = useState(false);
  useEffect(() => { setHl(q ? 0 : -1); }, [q, activeCategory, view]);
  const listRef = useRef<FlatList<Product>>(null);
  const scrollY = useRef(0);
  const viewportH = useRef(0);
  const highlighted = hl >= 0 && hl < filtered.length ? filtered[hl]! : null;

  const reveal = useCallback((index: number) => {
    const row = Math.floor(index / Math.max(1, columns));
    const to = scrollToReveal(row, rowSpan, viewportH.current, scrollY.current);
    if (to !== null) listRef.current?.scrollToOffset({ offset: to, animated: false });
  }, [columns, rowSpan]);

  const move = (dir: Direction) => (e: KeyboardEvent) => {
    // Up/Down also work from the search box; any other text field keeps its keys
    const inSearch = e.target === (searchRef.current as unknown) || (e.target as HTMLElement | null)?.getAttribute?.('data-testid') === 'pos-search';
    if (isTypingTarget(e.target) && !inSearch) return false;
    if (!filtered.length) return false;
    const next = moveHighlight(hl, dir, columns, filtered.length);
    setHl(next);
    setKbActive(true);
    reveal(next);
    return undefined;
  };
  useHotkeys({
    ArrowDown: { handler: move('down'), global: true },
    ArrowUp: { handler: move('up'), global: true },
    ArrowLeft: move('left'),
    ArrowRight: move('right'),
    // In the search box Enter goes to onSubmitEditing (exact barcode first); elsewhere it adds the highlight
    Enter: () => { if (!highlighted || !(kbActive || q)) return false; onPick(highlighted); return undefined; },
  }, [], { enabled: keyboard });

  const pick = useCallback((p: Product, index: number) => {
    setHl(index);
    onPick(p);
  }, [onPick]);

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => { scrollY.current = e.nativeEvent.contentOffset.y; };

  const accents = useMemo(() => [colors.primary, colors.accent, colors.info, colors.success, colors.danger, colors.warning, colors.primaryHover, colors.textSubtle],
    [colors]);
  const accentFor = useCallback((p: Product) => (p.category_id && catIndex.has(p.category_id) ? accents[catIndex.get(p.category_id)! % accents.length]! : colors.border),
    [catIndex, accents, colors.border]);
  const showHl = kbActive || !!q;

  const renderItem = useCallback(({ item, index }: { item: Product; index: number }) => {
    const qty = inCart.get(item.id) ?? 0;
    const isHl = showHl && index === hl;
    const mark = stockMark(item, lowStockDefault, stockBlocking);
    if (isGrid) {
      return (
        <ProductTile product={item} index={index} width={grid.tileWidth} height={grid.tileHeight} gapBelow={grid.gap} compact={compact} qty={qty}
          adjustPct={adjustPct} channel={channel} currency={currency} accent={accentFor(item)} highlighted={isHl} onPick={pick} stock={mark} />
      );
    }
    return (
      <ProductRow product={item} index={index} height={list.rowHeight} qty={qty} adjustPct={adjustPct} channel={channel} currency={currency}
        highlighted={isHl} onPick={pick} onDecrement={onDecrement} stock={mark} />
    );
  }, [inCart, showHl, hl, isGrid, grid.tileWidth, grid.tileHeight, grid.gap, compact, adjustPct, channel, currency, accentFor, pick, list.rowHeight, onDecrement,
    lowStockDefault, stockBlocking]);

  const getItemLayout = useCallback((_: unknown, index: number) => rowLayout(rowSpan, 0, index), [rowSpan]);
  const initialRows = Math.ceil(800 / rowSpan) + 1;

  return (
    <View style={styles.root} onLayout={onLayout}>
      {header}
      <View style={[styles.searchRow, { paddingHorizontal: pad, paddingTop: compact ? 8 : 14 }]}>
        <View style={[styles.search, { borderColor: focused ? colors.focus : colors.border, backgroundColor: colors.surface, borderRadius: radius.md },
          focused && Platform.OS === 'web' ? ({ boxShadow: `0 0 0 3px ${colors.primarySoft}` } as any) : null]}>
          <Ionicons name="search" size={18} color={colors.textSubtle} style={{ marginLeft: 12 }} />
          <TextInput
            ref={searchRef}
            value={query}
            onChangeText={onQueryChange}
            onSubmitEditing={(e) => onSubmitSearch(e.nativeEvent.text ?? query, highlighted)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={compact ? t('pos.ProductBrowser.search_or_scan') : t('pos.ProductBrowser.search_items_sku_or_scan_a_barcode')}
            placeholderTextColor={colors.textSubtle}
            autoFocus={autoFocusSearch}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="done"
            blurOnSubmit={false}
            accessibilityLabel={t('pos.ProductBrowser.search_items_or_scan_a_barcode')}
            testID="pos-search"
            style={[styles.searchInput, { color: colors.text, fontFamily: fonts.regular }, Platform.OS === 'web' && ({ outlineStyle: 'none' } as any)]}
          />
          {query ? (
            <Pressable onPress={() => onQueryChange('')} accessibilityRole="button" accessibilityLabel={t('common.clear_search')} style={styles.searchIcon} hitSlop={6}>
              <Ionicons name="close-circle" size={18} color={colors.textSubtle} />
            </Pressable>
          ) : !focused ? <ShortcutHint keys="/" style={{ marginRight: 8 }} /> : null}
          <Pressable onPress={onScan} accessibilityRole="button" accessibilityLabel={t('pos.ProductBrowser.scan_barcode_with_camera')}
            style={({ hovered }: any) => [styles.searchIcon, { borderLeftWidth: 1, borderLeftColor: colors.divider, backgroundColor: hovered ? colors.surfaceSunken : 'transparent' }]}>
            <Ionicons name="barcode-outline" size={20} color={colors.textMuted} />
          </Pressable>
        </View>
        <IconButton icon={isGrid ? 'list' : 'grid-outline'} variant="secondary" onPress={() => onViewChange(isGrid ? 'list' : 'grid')}
          accessibilityLabel={isGrid ? t('pos.ProductBrowser.show_items_as_a_list') : t('pos.ProductBrowser.show_items_as_tiles')} testID="pos-view-toggle" />
        {actions?.(compact)}
      </View>

      {products.length > 0 && visibleCats.length > 0 && !q ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsScroll}
          contentContainerStyle={[styles.chips, { paddingHorizontal: pad }]} keyboardShouldPersistTaps="handled">
          <Chip label={t('common.all')} selected={!activeCategory} onPress={() => setCategory(null)} count={products.length} />
          {visibleCats.map((c) => (
            <Chip key={c.id} label={c.name} selected={activeCategory === c.id} onPress={() => setCategory(c.id)} count={counts.get(c.id)} />
          ))}
        </ScrollView>
      ) : q ? (
        <View style={[styles.resultsRow, { paddingHorizontal: pad }]}>
          <Text variant="caption" tone="muted" numberOfLines={1} style={{ flex: 1 }}>
            {t('pos.ProductBrowser.length_match', { length: filtered.length })}{filtered.length === 1 ? '' : 'es'}{filtered.length ? t('pos.ProductBrowser.enter_adds_the_highlighted_item') : ''}
          </Text>
        </View>
      ) : <View style={{ height: 10 }} />}

      {products.length === 0 ? (
        <View style={{ flex: 1 }}>{emptyMenu}</View>
      ) : filtered.length === 0 ? (
        <EmptyState icon="search-outline" title={t('pos.ProductBrowser.no_items_match_q', { q })} message={t('pos.ProductBrowser.check_the_spelling_or_search_by_sku_or')} />
      ) : width > 0 ? (
        <FlatList
          ref={listRef}
          style={styles.list}
          key={`${view}-${columns}`}
          data={filtered}
          numColumns={columns}
          keyExtractor={(p) => p.id}
          extraData={renderItem}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: pad, paddingBottom: pad + bottomInset }}
          columnWrapperStyle={columns > 1 ? { gap: isGrid ? grid.gap : list.gap } : undefined}
          getItemLayout={getItemLayout}
          initialNumToRender={initialRows * columns}
          maxToRenderPerBatch={Math.max(8, columns * 4)}
          windowSize={5}
          removeClippedSubviews={Platform.OS === 'android'}
          onScroll={onScroll}
          scrollEventThrottle={32}
          onLayout={(e) => { viewportH.current = e.nativeEvent.layout.height; }}
          renderItem={renderItem}
          testID="pos-items"
        />
      ) : null}
    </View>
  );
}

const fromPriceOf = (p: Product, adjustPct: number, channel: ChannelCode) =>
  (p.variants.length ? Math.min(...p.variants.map((v) => unitPriceFor(p, v.id, adjustPct, channel))) : null);

/** ₹70 instead of ₹70.00 on tiles; paise only when the price has them. */
function tilePrice(value: number, currency: string): string {
  return money(value, currency, Math.abs(value % 1) < 0.005);
}

interface ItemProps {
  product: Product; index: number; qty: number; adjustPct: number; channel: ChannelCode; currency: string; highlighted: boolean;
  onPick: (p: Product, index: number) => void;
  /** "Sold out" (greyed) or "N left" */
  stock?: StockMark | null;
}

/** Spoken label part and the small text shown on the tile / row. */
function stockText(stock: StockMark | null | undefined): string | null {
  if (!stock) return null;
  return stock.kind === 'out' ? t('stock.sold_out') : t('stock.n_left', { count: stock.left });
}

/** "Sold out" / "N left" pill (not pressable: it sits inside the tile's button). */
function StockPill({ stock }: { stock: StockMark }) {
  const { colors, radius } = useTheme();
  const out = stock.kind === 'out';
  return (
    <View style={{ alignSelf: 'flex-start', paddingHorizontal: 6, paddingVertical: 1, borderRadius: radius.sm,
      backgroundColor: out ? colors.dangerSoft : colors.warningSoft }}>
      <Text variant="caption" color={out ? colors.dangerText : colors.warningText} numberOfLines={1}>{stockText(stock)}</Text>
    </View>
  );
}

/** Grid tile: fixed size, name on two lines, price, quantity already on the bill. */
const ProductTile = memo(function ProductTile({ product, index, width, height, gapBelow, compact, qty, adjustPct, channel, currency, accent, highlighted, onPick, stock }: ItemProps & {
  width: number; height: number; gapBelow: number; compact: boolean; accent: string;
}) {
  const { colors, radius } = useTheme();
  const hasVariants = product.variants.length > 0;
  const price = unitPriceFor(product, null, adjustPct, channel);
  const fromPrice = fromPriceOf(product, adjustPct, channel);
  const showFrom = hasVariants && fromPrice !== null && fromPrice !== price;
  return (
    <Pressable
      onPress={() => onPick(product, index)}
      accessibilityRole="button"
      accessibilityLabel={`${product.name}, ${money(showFrom ? fromPrice! : price, currency)}${hasVariants ? t('pos.ProductBrowser.has_options') : ''}${qty ? t('pos.ProductBrowser.qty_in_bill', { qty }) : ''}${stock ? `, ${stockText(stock)}` : ''}`}
      style={({ pressed, hovered }: any) => [
        styles.tile,
        stock?.kind === 'out' && { opacity: 0.55 },
        {
          width, height, marginBottom: gapBelow,
          padding: compact ? 8 : 10,
          paddingTop: compact ? 10 : 12,
          borderRadius: radius.md,
          backgroundColor: pressed ? colors.surfaceSunken : qty ? colors.primarySoft : hovered ? colors.surfaceAlt : colors.surface,
          borderColor: highlighted ? colors.focus : qty ? colors.primary : hovered ? colors.borderStrong : colors.border,
          borderWidth: highlighted ? 2 : 1,
          transform: [{ scale: pressed ? 0.97 : 1 }],
        },
        Platform.OS === 'web' && ({ cursor: 'pointer', transitionDuration: '90ms', userSelect: 'none' } as any),
      ]}
    >
      <View style={[styles.accent, { backgroundColor: accent }]} />
      <View style={styles.tileName}>
        <Text variant={compact ? 'smallStrong' : 'bodyStrong'} numberOfLines={2} style={{ flex: 1 }}>{product.name}</Text>
        {qty ? (
          <View style={[styles.qty, { backgroundColor: colors.primary }]}>
            <Text variant="caption" color={colors.primaryText} style={styles.num}>{qty}</Text>
          </View>
        ) : null}
      </View>
      {stock ? <StockPill stock={stock} /> : null}
      <View style={styles.tileBottom}>
        <VegMark veg={product.is_veg} size={11} />
        <Text variant="money" style={[{ fontSize: compact ? 14 : 15, flexShrink: 1 }, styles.num]} numberOfLines={1}>
          {tilePrice(showFrom ? fromPrice! : price, currency)}{showFrom ? '+' : ''}
        </Text>
        {hasVariants ? (
          <Text variant="caption" tone="subtle" numberOfLines={1} style={{ marginLeft: 'auto', flexShrink: 1 }}>
            {product.variants.length} {compact ? 'opt' : 'options'}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
});

/** List row: name, price and a +/- stepper with the quantity already on the bill. */
const ProductRow = memo(function ProductRow({ product, index, height, qty, adjustPct, channel, currency, highlighted, onPick, onDecrement, stock }: ItemProps & {
  height: number; onDecrement: (p: Product) => void;
}) {
  const { colors, radius } = useTheme();
  const hasVariants = product.variants.length > 0;
  const price = unitPriceFor(product, null, adjustPct, channel);
  const fromPrice = fromPriceOf(product, adjustPct, channel);
  const showFrom = hasVariants && fromPrice !== null && fromPrice !== price;
  const step = Math.min(44, height - 8);
  return (
    <View style={[styles.row, { height, borderBottomColor: colors.divider }, highlighted && { backgroundColor: colors.selectedRow, borderRadius: radius.sm }]}>
      <Pressable onPress={() => onPick(product, index)} accessibilityRole="button"
        accessibilityLabel={`${t('pos.ProductBrowser.name_money_v_add_one', { name: product.name, money: money(showFrom ? fromPrice! : price, currency), v: hasVariants ? t('pos.ProductBrowser.has_options') : '' })}${stock ? `, ${stockText(stock)}` : ''}`}
        style={({ hovered }: any) => [styles.rowMain, { borderRadius: radius.sm }, hovered && { backgroundColor: colors.surfaceAlt },
          highlighted && Platform.OS === 'web' && ({ boxShadow: `inset 0 0 0 2px ${colors.focus}` } as any),
          Platform.OS === 'web' && ({ cursor: 'pointer', userSelect: 'none' } as any)]}>
        <VegMark veg={product.is_veg} size={12} />
        <View style={{ flex: 1, minWidth: 0, opacity: stock?.kind === 'out' ? 0.55 : 1 }}>
          <Text variant="bodyStrong" numberOfLines={1}>{product.name}</Text>
          {stock ? <StockPill stock={stock} /> : null}
          {hasVariants && height >= 52 && !stock ? <Text variant="caption" tone="subtle" numberOfLines={1}>{product.variants.map((v) => v.name).join(' / ')}</Text> : null}
        </View>
        <Text variant="money" style={[styles.rowPrice, styles.num]} numberOfLines={1}>
          {tilePrice(showFrom ? fromPrice! : price, currency)}{showFrom ? '+' : ''}
        </Text>
      </Pressable>
      {/* Fixed-width slot: names and prices stay aligned whether or not the item is on the bill */}
      <View style={{ width: step * 2 + 30, alignItems: 'flex-end' }}>
      <View style={[styles.stepper, { borderColor: qty ? colors.primary : colors.border, borderRadius: radius.md, backgroundColor: qty ? colors.primarySoft : colors.surface }]}>
        {qty ? (
          <>
            <StepButton icon={qty === 1 ? 'trash-outline' : 'remove'} size={step} label={qty === 1 ? t('pos.ProductBrowser.remove_name', { name: product.name }) : t('pos.ProductBrowser.one_less_name', { name: product.name })}
              danger={qty === 1} onPress={() => onDecrement(product)} />
            <View style={[styles.stepQty, { height: step }]}>
              <Text variant="bodyStrong" color={colors.primarySoftText} style={styles.num}>{qty}</Text>
            </View>
          </>
        ) : null}
        <StepButton icon="add" size={step} label={t('pos.ProductBrowser.add_name', { name: product.name })} onPress={() => onPick(product, index)} />
      </View>
      </View>
    </View>
  );
});

function StepButton({ icon, size, label, danger, onPress }: {
  icon: React.ComponentProps<typeof Ionicons>['name']; size: number; label: string; danger?: boolean; onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={4}
      style={({ pressed, hovered }: any) => [{ width: size, height: size, alignItems: 'center', justifyContent: 'center' },
        (pressed || hovered) && { backgroundColor: colors.surfaceSunken }, Platform.OS === 'web' && ({ cursor: 'pointer', userSelect: 'none' } as any)]}>
      <Ionicons name={icon} size={18} color={danger ? colors.danger : colors.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, minWidth: 0 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 0 },
  search: { flex: 1, flexDirection: 'row', alignItems: 'center', borderWidth: 1, minHeight: 46, overflow: 'hidden' },
  searchInput: { flex: 1, fontSize: 15, paddingHorizontal: 10, paddingVertical: Platform.OS === 'web' ? 12 : 10, minWidth: 0 },
  searchIcon: { height: 46, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  chipsScroll: { flexGrow: 0, flexShrink: 0, marginVertical: 10 },
  chips: { gap: 8, alignItems: 'center' },
  resultsRow: { flexDirection: 'row', alignItems: 'center', height: 36, flexShrink: 0 },
  list: { flex: 1, minHeight: 0 },
  tile: { overflow: 'hidden', justifyContent: 'space-between' },
  accent: { position: 'absolute', top: 0, left: 0, bottom: 0, width: 3 },
  tileName: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  tileBottom: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  qty: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
  row: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  rowMain: { flex: 1, minWidth: 0, alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 6 },
  rowPrice: { fontSize: 15, minWidth: 56, textAlign: 'right' },
  stepper: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, overflow: 'hidden' },
  stepQty: { minWidth: 28, alignItems: 'center', justifyContent: 'center' },
  num: { fontVariant: ['tabular-nums'] },
});
