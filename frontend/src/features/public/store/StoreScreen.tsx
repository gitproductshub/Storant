/**
 * Customer-facing ordering page: /store/<tenantId> (online store) or /store/<tenantId>?table=<tableId> (QR at the table).
 * No login. Mobile-first, centred column on desktop. The cart lives in localStorage per business.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Linking, Platform, Pressable, ScrollView, StyleSheet, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { Button, Chip, EmptyState, IconButton, Input, Text, VegMark, toast } from '@/components/ui';
import { ApiError, errorMessage } from '@/api/client';
import { PublicFooter, Notice } from '../PublicPage';
import { PageTitle } from '../PageTitle';
import { readJson, removeKey, writeJson } from '../storage';
import {
  MAX_QTY, TABLE_ORDER_TTL_MS, UUID_RE, allowedPayments, cartKey, customerKey, isActiveTableOrder, lineKey, newOrderId,
  orderKey, reconcileCart, statusStage, tableName, tableOrderKey,
  type CartLine, type CustomerDetails, type MenuProduct, type OrderMode, type PlacedOrder, price,
} from './model';
import { storeApi, type PlaceOrderBody, type StoreMenu } from './api';
import { ProductRow, ProductSkeleton } from './parts';
import { VariantSheet } from './VariantSheet';
import { CartSheet, type CheckoutInput } from './CartSheet';
import { OrderTracker } from './OrderTracker';
import { TableOrderTracker } from './TableOrderTracker';
import { brand } from '@/config/brand';
import { t as tr } from '@/i18n';

const MAX_WIDTH = 720;
const CART_TTL_MS = 2 * 24 * 3600 * 1000;
const ORDER_TTL_MS = 12 * 3600 * 1000;
const OTHER_CATEGORY = '__other__';
const INITIAL_RENDER = 30;
const RENDER_STEP = 60;

type LoadError = { kind: 'notfound' | 'unavailable' | 'ratelimit' | 'network' | 'other'; message: string };

function param(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? '';
}

const STATUS_LABEL: Record<string, string> = { get placed() { return tr('public.store_StoreScreen.received'); }, get open() { return tr('public.store_StoreScreen.being_prepared'); }, get completed() { return tr('common.completed'); }, get cancelled() { return tr('common.cancelled'); } };
const TABLE_STATUS_LABEL: Record<string, string> = {
  get placed() { return tr('public.store_StoreScreen.waiting_for_the_restaurant_to_confirm'); }, get open() { return tr('common.in_the_kitchen'); }, get completed() { return tr('public.store_StoreScreen.paid_thank_you'); }, get cancelled() { return tr('common.cancelled'); },
};

export default function StoreScreen() {
  const params = useLocalSearchParams<{ tenantId: string; table?: string }>();
  const tenantId = param(params.tenantId);
  const tableParam = param(params.table);
  const mode: OrderMode = tableParam ? 'QR' : 'ONLINE';
  // Table orders are remembered per table ("Order more" adds to the same bill); online orders per shop
  const savedKey = mode === 'QR' ? tableOrderKey(tenantId, tableParam) : orderKey(tenantId);
  const savedTtl = mode === 'QR' ? TABLE_ORDER_TTL_MS : ORDER_TTL_MS;

  const { colors, radius, shadow } = useTheme();
  const { isPhone } = useLayout();
  const insets = useSafeAreaInsets();
  const pad = isPhone ? 16 : 24;

  const [menu, setMenu] = useState<StoreMenu | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<LoadError | null>(null);
  const [table, setTable] = useState<{ id: string; table_number: string } | null>(null);
  const [tableError, setTableError] = useState<string | null>(null);
  const [lines, setLines] = useState<CartLine[]>([]);
  const [cartNotice, setCartNotice] = useState<string | null>(null);
  const [orderingBlocked, setOrderingBlocked] = useState(false);
  const [query, setQuery] = useState('');
  const [vegOnly, setVegOnly] = useState(false);
  const [activeCat, setActiveCat] = useState<string | null>(null);
  /** Phones: the search box opens from an icon so the sticky bar stays one row high */
  const [searchOpen, setSearchOpen] = useState(false);
  /** Big menus render progressively so a cheap phone shows the first items at once */
  const [renderLimit, setRenderLimit] = useState(INITIAL_RENDER);
  const [variantProduct, setVariantProduct] = useState<MenuProduct | null>(null);
  const [variantOpen, setVariantOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [savedOrder, setSavedOrder] = useState<PlacedOrder | null>(null);
  const [view, setView] = useState<'menu' | 'tracker'>('menu');
  const [customer, setCustomer] = useState<CustomerDetails | null>(null);

  const hydrated = useRef(false);
  const pendingOrderId = useRef<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const chipsRef = useRef<ScrollView>(null);
  const bodyY = useRef(0);
  const stickyH = useRef(0);
  const sectionY = useRef<Record<string, number>>({});
  const chipX = useRef<Record<string, number>>({});

  // ---- Loading ----
  const load = useCallback(async () => {
    if (!UUID_RE.test(tenantId)) {
      setLoadError({ kind: 'notfound', message: '' });
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const tablePromise = tableParam
        ? (UUID_RE.test(tableParam) ? storeApi.table(tenantId, tableParam) : Promise.reject(new ApiError(tr('public.store_StoreScreen.not_found'), 404)))
        : Promise.resolve(null);
      const [m, t] = await Promise.all([storeApi.menu(tenantId, mode), tablePromise.then((v) => ({ ok: true as const, v }), (e) => ({ ok: false as const, e }))]);
      setMenu(m);
      if (t.ok) {
        setTable(t.v);
        setTableError(null);
      } else {
        setTable(null);
        setTableError(t.e instanceof ApiError && t.e.network
          ? "We couldn't check your table. Check your connection and try again."
          : "We couldn't recognise this table's QR code. Please scan it again or ask the staff.");
      }
      if (!hydrated.current) {
        const saved = readJson<{ lines: CartLine[]; savedAt: number }>(cartKey(tenantId));
        if (saved && Array.isArray(saved.lines) && Date.now() - (saved.savedAt ?? 0) < CART_TTL_MS) {
          const r = reconcileCart(saved.lines, m);
          setLines(r.lines);
          if (r.removed) setCartNotice(`${r.removed} item${r.removed > 1 ? 's' : ''} in your cart ${r.removed > 1 ? 'are' : 'is'} no longer available and ${r.removed > 1 ? 'were' : 'was'} removed.`);
        }
        const order = readJson<PlacedOrder>(savedKey);
        if (order && order.id && Date.now() - new Date(order.placedAt).getTime() < savedTtl) {
          setSavedOrder(order);
          // Back at the table with an open bill (e.g. after paying in the UPI app): go straight to it
          if (isActiveTableOrder(order)) setView('tracker');
          // Refresh the banner's status quietly; the tracker polls once opened
          storeApi.order(tenantId, order.id).then(
            (st) => { if (st?.status) onOrderStatusRef.current(st.status); },
            (err) => { if (err instanceof ApiError && err.status === 404) onOrderStatusRef.current('missing'); },
          );
        } else if (order) removeKey(savedKey);
        setCustomer(readJson<CustomerDetails>(customerKey(tenantId)));
        hydrated.current = true;
      } else {
        setLines((current) => reconcileCart(current, m).lines);
      }
    } catch (e) {
      const err = e instanceof ApiError ? e : null;
      if (err && (err.status === 404 || err.status === 422)) setLoadError({ kind: 'notfound', message: '' });
      else if (err && (err.status === 402 || err.status === 403)) {
        setLoadError({ kind: 'unavailable', message: mode === 'QR'
          ? tr('public.store_StoreScreen.the_menu_isn_t_available_online_right_now')
          : tr('public.store_StoreScreen.this_shop_s_online_menu_isn_t_available') });
      }
      else if (err?.status === 429) setLoadError({ kind: 'ratelimit', message: tr('public.store_StoreScreen.too_many_requests_from_your_network') });
      else if (err?.network) setLoadError({ kind: 'network', message: tr('public.store_StoreScreen.can_t_reach_the_shop_right_now_check_your') });
      else setLoadError({ kind: 'other', message: errorMessage(e) });
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, tableParam]);

  useEffect(() => { void load(); }, [load]);

  // ---- Cart persistence + idempotency key reset ----
  const cartSignature = lines.map((l) => `${l.key}x${l.qty}:${l.notes}`).join('|');
  useEffect(() => {
    pendingOrderId.current = null; // a different cart is a different order
    if (!hydrated.current || !tenantId) return;
    if (lines.length) writeJson(cartKey(tenantId), { lines, savedAt: Date.now() });
    else removeKey(cartKey(tenantId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartSignature, tenantId]);

  // ---- Derived ----
  const symbol = menu?.business.currency_symbol || '₹';
  const businessName = menu?.business.name || 'this shop';
  const orderingOpen = !!menu && (mode === 'QR' ? menu.ordering.qr : menu.ordering.store);
  const canOrder = orderingOpen && !orderingBlocked && (mode === 'ONLINE' || !!table);
  const hasVegInfo = !!menu?.products.some((p) => p.is_veg !== null);
  const qrPayment = menu?.ordering.qr_payment;
  const qrPayments = useMemo(() => allowedPayments(qrPayment), [qrPayment]);

  const qtyByProduct = useMemo(() => {
    const map: Record<string, number> = {};
    for (const l of lines) map[l.productId] = (map[l.productId] ?? 0) + l.qty;
    return map;
  }, [lines]);
  const cartCount = lines.reduce((n, l) => n + l.qty, 0);
  const cartTotal = lines.reduce((n, l) => n + l.qty * l.price, 0);

  const sections = useMemo(() => {
    if (!menu) return [];
    const q = query.trim().toLowerCase();
    const filtered = menu.products.filter((p) =>
      (!vegOnly || p.is_veg === true) &&
      (!q || p.name.toLowerCase().includes(q) || (p.description ?? '').toLowerCase().includes(q)));
    const known = new Set(menu.categories.map((c) => c.id));
    const groups = menu.categories.map((c) => ({ id: c.id, name: c.name, products: filtered.filter((p) => p.category_id === c.id) }));
    groups.push({ id: OTHER_CATEGORY, name: menu.categories.length ? 'Other items' : 'Menu', products: filtered.filter((p) => !p.category_id || !known.has(p.category_id)) });
    return groups.filter((g) => g.products.length > 0);
  }, [menu, query, vegOnly]);

  useEffect(() => {
    if (sections.length && !sections.some((s) => s.id === activeCat)) setActiveCat(sections[0].id);
  }, [sections, activeCat]);

  const totalItems = useMemo(() => sections.reduce((n, sec) => n + sec.products.length, 0), [sections]);
  useEffect(() => {
    if (renderLimit >= totalItems) return undefined;
    const id = setTimeout(() => setRenderLimit((n) => n + RENDER_STEP), 60);
    return () => clearTimeout(id);
  }, [renderLimit, totalItems]);
  /** Sections cut to the items rendered so far */
  const visibleSections = useMemo(() => {
    let left = renderLimit;
    const out: typeof sections = [];
    for (const sec of sections) {
      if (left <= 0) break;
      out.push(left >= sec.products.length ? sec : { ...sec, products: sec.products.slice(0, left) });
      left -= sec.products.length;
    }
    return out;
  }, [sections, renderLimit]);

  // ---- Cart actions ----
  const setQty = useCallback((key: string, qty: number) => {
    setLines((ls) => (qty <= 0 ? ls.filter((l) => l.key !== key) : ls.map((l) => (l.key === key ? { ...l, qty: Math.min(MAX_QTY, qty) } : l))));
  }, []);

  const addLine = useCallback((p: MenuProduct, variantId: string | null, qty = 1) => {
    const variant = variantId ? p.variants.find((v) => v.id === variantId) ?? null : null;
    const key = lineKey(p.id, variantId);
    setLines((ls) => {
      const existing = ls.find((l) => l.key === key);
      if (existing) return ls.map((l) => (l.key === key ? { ...l, qty: Math.min(MAX_QTY, l.qty + qty) } : l));
      if (ls.length >= 50) {
        toast.warning(tr('public.store_StoreScreen.your_cart_is_full_place_this_order_first'));
        return ls;
      }
      return [...ls, {
        key, productId: p.id, variantId, name: p.name, variantName: variant?.name ?? null, price: variant?.price ?? p.price,
        isVeg: p.is_veg, qty, notes: '',
      }];
    });
  }, []);

  const onAdd = (p: MenuProduct) => {
    if (p.variants.length) {
      setVariantProduct(p);
      setVariantOpen(true);
    } else {
      addLine(p, null, 1);
    }
  };

  const changeProductQty = (p: MenuProduct, qty: number) => setQty(lineKey(p.id, null), qty);

  // ---- Place order ----
  const place = async (input: CheckoutInput): Promise<string | null> => {
    if (!menu || !lines.length) return 'Your cart is empty.';
    if (mode === 'QR' && !table) return "We couldn't recognise your table. Please scan the QR code again.";
    if (!pendingOrderId.current) pendingOrderId.current = newOrderId();
    const body: PlaceOrderBody = {
      id: pendingOrderId.current,
      source: mode,
      order_type: mode === 'QR' ? 'DINE_IN' : input.orderType,
      table_id: mode === 'QR' ? table?.id ?? null : null,
      customer_name: input.name,
      customer_phone: input.phoneDigits,
      delivery_address: mode === 'ONLINE' && input.orderType === 'DELIVERY' ? input.address : null,
      notes: input.notes || null,
      ...(mode === 'QR' ? { payment: input.payment } : {}),
      items: lines.map((l) => ({ product_id: l.productId, variant_id: l.variantId, quantity: l.qty, notes: l.notes.trim() || null })),
    };
    try {
      const r = await storeApi.placeOrder(tenantId, body);
      const placed: PlacedOrder = {
        id: r.id, code: r.code, token_no: r.token_no ?? null, total_amount: r.total_amount, status: r.status,
        placedAt: new Date().toISOString(), mode, orderType: mode === 'QR' ? 'DINE_IN' : input.orderType, tableLabel: table?.table_number ?? null,
        ...(mode === 'QR' ? { tableId: table?.id ?? null, phone: input.phoneDigits, payment: input.payment, paid: false } : {}),
      };
      const details: CustomerDetails = { name: input.name, phone: input.phone, address: input.address, orderType: input.orderType };
      writeJson(savedKey, placed);
      writeJson(customerKey(tenantId), details);
      setCustomer(details);
      pendingOrderId.current = null;
      setCartOpen(false);
      setLines([]);
      setSavedOrder(placed);
      setView('tracker');
      scrollRef.current?.scrollTo({ y: 0, animated: false });
      return null;
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 403 || e.status === 402) {
          setOrderingBlocked(true);
          setCartOpen(false);
          toast.warning(mode === 'QR' ? tr('public.store_StoreScreen.ordering_isn_t_available_right_now_please') : tr('public.store_StoreScreen.this_shop_isn_t_taking_online_orders'));
          return e.message;
        }
        if (e.status === 400 && mode === 'QR' && /payment option/i.test(e.message)) {
          void load(); // the owner changed the payment options: pick up the new ones
          return 'That payment option was just turned off. Please choose another one.';
        }
        if (e.status === 429) return "You've placed several orders in a short time. Please wait a few minutes and try again.";
        if (e.network) return "Couldn't reach the shop. Check your connection and tap Place order again — it won't be duplicated.";
        if (e.status === 404) return 'This shop or table could not be found. Please ask the staff for help.';
        if (e.status === 409) return e.message;
        if (e.status >= 500) return "The shop's system had a problem. Please try again in a moment.";
        return e.message;
      }
      return errorMessage(e);
    }
  };

  const onOrderStatus = useCallback((status: string) => {
    if (status === 'missing') {
      removeKey(savedKey);
      setSavedOrder(null);
      setView('menu');
      return;
    }
    setSavedOrder((o) => {
      if (!o || o.status === status) return o;
      const next = { ...o, status };
      writeJson(savedKey, next);
      return next;
    });
  }, [savedKey]);

  const onOrderStatusRef = useRef(onOrderStatus);
  onOrderStatusRef.current = onOrderStatus;

  /** Table tracker: keep the remembered bill (status, total, payment choice) in step */
  const patchSavedOrder = useCallback((patch: Partial<PlacedOrder>) => {
    setSavedOrder((o) => {
      if (!o) return o;
      const next = { ...o, ...patch };
      if (JSON.stringify(next) === JSON.stringify(o)) return o;
      writeJson(savedKey, next);
      return next;
    });
  }, [savedKey]);

  const dismissSavedOrder = () => {
    removeKey(savedKey);
    setSavedOrder(null);
  };

  // ---- Scroll sync between category chips and sections ----
  const jumpTo = (id: string) => {
    setActiveCat(id);
    const y = sectionY.current[id];
    if (y === undefined || renderLimit < totalItems) {
      setRenderLimit(Number.MAX_SAFE_INTEGER);
      setTimeout(() => {
        const later = sectionY.current[id];
        if (later !== undefined) scrollRef.current?.scrollTo({ y: Math.max(0, bodyY.current + later - stickyH.current - 4), animated: false });
      }, 120);
      return;
    }
    scrollRef.current?.scrollTo({ y: Math.max(0, bodyY.current + y - stickyH.current - 4), animated: true });
  };

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y + stickyH.current + 24;
    let current = sections[0]?.id ?? null;
    for (const s of sections) {
      const top = sectionY.current[s.id];
      if (top !== undefined && bodyY.current + top <= y) current = s.id;
    }
    if (current && current !== activeCat) setActiveCat(current);
  };

  useEffect(() => {
    if (!activeCat) return;
    const x = chipX.current[activeCat];
    if (x !== undefined) chipsRef.current?.scrollTo({ x: Math.max(0, x - 16), animated: true });
  }, [activeCat]);

  // ---- Render helpers ----
  const pageTitle = !menu ? 'Order online'
    : mode === 'QR' ? `${table ? `${tableName(table.table_number)} · ` : ''}${menu.business.name}` : `${menu.business.name} · Order online`;

  if (loading && !menu) {
    return (
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <PageTitle title={tr('public.store_StoreScreen.loading_menu')} />
        <View style={[styles.hero, { backgroundColor: colors.surface, borderBottomColor: colors.border, paddingTop: insets.top + 24, paddingHorizontal: pad }]}>
          <View style={{ width: '100%', maxWidth: MAX_WIDTH, gap: 12 }}>
            <View style={{ width: 56, height: 56, borderRadius: 16, backgroundColor: colors.surfaceSunken }} />
            <View style={{ width: '60%', height: 26, borderRadius: radius.sm, backgroundColor: colors.surfaceSunken }} />
            <View style={{ width: '40%', height: 14, borderRadius: radius.sm, backgroundColor: colors.surfaceSunken }} />
          </View>
        </View>
        <View style={{ width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center', padding: pad, paddingTop: 28 }} accessibilityLabel={tr('public.store_StoreScreen.loading_menu_2')}>
          <ProductSkeleton />
        </View>
      </View>
    );
  }

  if (loadError || !menu) {
    const e = loadError ?? { kind: 'other' as const, message: tr('public.store_StoreScreen.something_went_wrong') };
    return (
      <View style={[styles.root, styles.center, { backgroundColor: colors.background, padding: pad }]}>
        <PageTitle title={e.kind === 'notfound' ? tr('public.store_StoreScreen.shop_not_found') : tr('public.store_StoreScreen.order_online')} />
        <View style={{ maxWidth: 440, width: '100%' }}>
          {e.kind === 'notfound' ? (
            <EmptyState icon="storefront-outline" title={tr('public.store_StoreScreen.we_couldn_t_find_this_shop')}
              message={tr('public.store_StoreScreen.the_link_may_be_mistyped_or_this_shop_is', { brand: brand.name })} />
          ) : e.kind === 'unavailable' ? (
            <EmptyState icon="restaurant-outline" title={tr('public.store_StoreScreen.menu_unavailable')} message={e.message} />
          ) : (
            <EmptyState icon={e.kind === 'network' ? 'cloud-offline-outline' : e.kind === 'ratelimit' ? 'hourglass-outline' : 'alert-circle-outline'}
              title={e.kind === 'network' ? tr('common.you_re_offline') : e.kind === 'ratelimit' ? tr('public.store_StoreScreen.please_wait_a_moment') : tr('public.store_StoreScreen.couldn_t_load_the_menu')}
              message={e.message} action={{ label: tr('common.try_again'), icon: 'refresh', onPress: () => void load() }} />
          )}
          <PublicFooter />
        </View>
      </View>
    );
  }

  const business = menu.business;
  const taxLabel = business.prices_include_tax ? 'Prices include GST' : '+ GST as applicable';

  // On the order tracker the hero shrinks to the name, so the order status is above the fold on phones
  const compactHero = view === 'tracker' && !!savedOrder;
  const hero = (
    <View style={[styles.hero, { backgroundColor: colors.surface, borderBottomColor: colors.border, paddingTop: insets.top + (isPhone || compactHero ? 16 : 32), paddingHorizontal: pad },
      compactHero && { paddingBottom: 14 }]}>
      <View style={{ width: '100%', maxWidth: MAX_WIDTH, gap: 14 }}>
        <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
          <View style={[styles.avatar, { backgroundColor: colors.primary }]} accessibilityElementsHidden importantForAccessibility="no">
            <Text variant="h1" color={colors.primaryText}>{business.name.trim().charAt(0).toUpperCase() || 'T'}</Text>
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            {mode === 'QR' && table ? (
              <Text variant="smallStrong" tone="primary" style={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
                {tr('public.store_StoreScreen.tablename_dine_in', { tableName: tableName(table.table_number) })}
              </Text>
            ) : null}
            <Text variant={isPhone ? 'h1' : 'display'} accessibilityRole="header" numberOfLines={2}
              accessibilityLabel={mode === 'QR' && table ? `${tableName(table.table_number)}, ${business.name}` : business.name}>{business.name}</Text>
            {business.address && !compactHero ? (
              <View style={{ flexDirection: 'row', gap: 4, alignItems: 'flex-start' }}>
                <Ionicons name="location-outline" size={14} color={colors.textSubtle} style={{ marginTop: 2 }} />
                <Text variant="small" tone="muted" style={{ flex: 1 }} numberOfLines={2}>{business.address}</Text>
              </View>
            ) : null}
          </View>
        </View>
        {compactHero ? null : <View style={styles.badges}>
          {mode === 'QR' && table ? (
            <View style={[styles.pill, { backgroundColor: colors.primary }]}>
              <Ionicons name="restaurant" size={14} color={colors.primaryText} />
              <Text variant="smallStrong" color={colors.primaryText}>{tableName(table.table_number)}</Text>
            </View>
          ) : null}
          <View style={[styles.pill, { backgroundColor: canOrder ? colors.successSoft : colors.surfaceSunken }]}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: canOrder ? colors.success : colors.textSubtle }} />
            <Text variant="smallStrong" color={canOrder ? colors.successText : colors.textMuted}>{canOrder ? tr('public.store_StoreScreen.taking_orders') : tr('public.store_StoreScreen.menu_only')}</Text>
          </View>
          <View style={[styles.pill, { backgroundColor: colors.surfaceSunken }]}>
            <Ionicons name="pricetag-outline" size={13} color={colors.textMuted} />
            <Text variant="small" tone="muted">{taxLabel}</Text>
          </View>
          {business.phone ? (
            <Pressable onPress={() => void Linking.openURL(`tel:${business.phone!.replace(/\s/g, '')}`).catch(() => {})} accessibilityRole="link"
              accessibilityLabel={tr('public.store_StoreScreen.call_name', { name: business.name })} style={[styles.pill, { backgroundColor: colors.surfaceSunken }, Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}>
              <Ionicons name="call-outline" size={13} color={colors.primary} />
              <Text variant="smallStrong" tone="primary">{business.phone}</Text>
            </Pressable>
          ) : null}
        </View>}
      </View>
    </View>
  );

  if (view === 'tracker' && savedOrder) {
    return (
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <PageTitle title={tr('public.store_StoreScreen.order_code_name', { code: savedOrder.code, name: business.name })} />
        <ScrollView ref={scrollRef} contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
          {hero}
          <View style={{ width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center', padding: pad, paddingTop: 20 }}>
            {savedOrder.mode === 'QR' ? (
              <TableOrderTracker tenantId={tenantId} order={savedOrder} symbol={symbol} businessName={business.name} phone={business.phone}
                onOrderMore={() => setView('menu')} onChange={patchSavedOrder} onMissing={() => onOrderStatus('missing')} />
            ) : (
              <OrderTracker tenantId={tenantId} order={savedOrder} symbol={symbol} businessName={business.name} phone={business.phone}
                onBack={() => setView('menu')} onStatus={onOrderStatus} />
            )}
            <PublicFooter businessName={business.name} />
          </View>
        </ScrollView>
      </View>
    );
  }

  const blockedTitle = mode === 'QR'
    ? (tableError ? "We couldn't recognise this table" : 'Ordering isn’t available right now — please ask the staff')
    : "This shop isn't taking online orders right now";
  const blockedBody = mode === 'QR'
    ? (tableError ?? 'You can still look through the menu. A waiter will take your order at the table.')
    : 'You can still browse the menu. Please order with the staff or try again later.';
  const activeBill = mode === 'QR' && isActiveTableOrder(savedOrder) && savedOrder
    ? { code: savedOrder.code, phone: savedOrder.phone ?? null } : null;

  const vegToggle = (
    <Pressable onPress={() => setVegOnly((v) => !v)} accessibilityRole="switch" accessibilityState={{ checked: vegOnly }}
      accessibilityLabel={tr('public.store_StoreScreen.show_vegetarian_items_only')}
      style={[styles.vegToggle, {
        borderRadius: radius.md, borderColor: vegOnly ? colors.veg : colors.border,
        backgroundColor: vegOnly ? colors.successSoft : colors.surface,
      }, Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}>
      <VegMark veg size={14} />
      <Text variant="smallStrong" color={vegOnly ? colors.successText : colors.text}>{isPhone ? tr('common.veg') : tr('public.store_StoreScreen.veg_only')}</Text>
      <View style={[styles.track, { backgroundColor: vegOnly ? colors.veg : colors.borderStrong }]}>
        <View style={[styles.thumb, { backgroundColor: colors.surface, alignSelf: vegOnly ? 'flex-end' : 'flex-start' }]} />
      </View>
    </Pressable>
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <PageTitle title={pageTitle} description={menu ? tr('public.store_StoreScreen.order_from_name_v', { name: menu.business.name, v: menu.business.address ? `, ${menu.business.address}` : '' }) : undefined} />
      <ScrollView
        ref={scrollRef}
        stickyHeaderIndices={[1]}
        onScroll={onScroll}
        scrollEventThrottle={64}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: insets.bottom + ((cartCount && canOrder) || savedOrder ? 112 : 32) }}
      >
        {hero}

        {/* Sticky: category chips + search + veg filter (one row on phones; search opens from an icon) */}
        <View onLayout={(e: LayoutChangeEvent) => { stickyH.current = e.nativeEvent.layout.height; }}
          style={[styles.sticky, { backgroundColor: colors.background, borderBottomColor: colors.border }]}>
          <View style={{ width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center', gap: 8, paddingHorizontal: pad, paddingTop: 8 }}>
            {!isPhone || searchOpen || query ? (
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                <Input value={query} onChangeText={setQuery} placeholder={tr('public.store_StoreScreen.search_the_menu')} icon="search" containerStyle={{ flex: 1 }}
                  accessibilityLabel={tr('public.store_StoreScreen.search_the_menu')} returnKeyType="search" autoCorrect={false} autoFocus={isPhone && searchOpen && !query}
                  right={query ? <IconButton icon="close-circle" accessibilityLabel={tr('common.clear_search')} onPress={() => setQuery('')} size="sm" /> : undefined} />
                {isPhone ? <Button title={tr('common.done')} variant="ghost" size="sm" onPress={() => { setSearchOpen(false); }} /> : null}
                {!isPhone && hasVegInfo ? vegToggle : null}
              </View>
            ) : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {sections.length > 1 ? (
                <ScrollView ref={chipsRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} style={{ flex: 1 }}
                  accessibilityRole="tablist" accessibilityLabel={tr('public.store_StoreScreen.menu_categories')}>
                  {sections.map((s) => (
                    <View key={s.id} onLayout={(e) => { chipX.current[s.id] = e.nativeEvent.layout.x; }}>
                      <Chip label={s.name} count={s.products.length} selected={activeCat === s.id} onPress={() => jumpTo(s.id)} />
                    </View>
                  ))}
                </ScrollView>
              ) : <View style={{ flex: 1 }} />}
              {isPhone && !searchOpen && !query ? (
                <>
                  <IconButton icon="search" variant="outline" accessibilityLabel={tr('public.store_StoreScreen.search_the_menu')} onPress={() => setSearchOpen(true)} />
                  {hasVegInfo ? vegToggle : null}
                </>
              ) : null}
            </View>
          </View>
        </View>

        {/* Menu */}
        <View onLayout={(e) => { bodyY.current = e.nativeEvent.layout.y; }}
          style={{ width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center', paddingHorizontal: pad, paddingTop: 16, gap: 12 }}>
          {savedOrder ? (
            <View style={[styles.trackBanner, { borderRadius: radius.lg, borderColor: colors.primary, backgroundColor: colors.primarySoft }]}>
              <Pressable onPress={() => setView('tracker')} accessibilityRole="button" accessibilityLabel={tr('public.store_StoreScreen.track_order_code', { code: savedOrder.code })}
                style={({ hovered }: any) => [styles.trackMain, { opacity: hovered ? 0.8 : 1 }, Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}>
                <Ionicons name={statusStage(savedOrder.status) === -1 ? 'close-circle' : 'receipt'} size={22} color={colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text variant="bodyStrong" color={colors.primarySoftText}>
                    {savedOrder.mode === 'QR' ? tr('public.store_StoreScreen.your_bill_code_price', { code: savedOrder.code, price: price(savedOrder.total_amount, symbol) }) : tr('public.store_StoreScreen.your_order_code', { code: savedOrder.code })}
                  </Text>
                  <Text variant="small" color={colors.primarySoftText}>
                    {savedOrder.mode === 'QR'
                      ? tr('public.store_StoreScreen.v_tap_to_track_v2', { v: savedOrder.paid ? tr('public.store_StoreScreen.paid') : TABLE_STATUS_LABEL[savedOrder.status] ?? tr('common.sent'), v2: savedOrder.paid ? '' : tr('public.store_StoreScreen.or_pay') })
                      : tr('public.store_StoreScreen.v_tap_to_track', { v: STATUS_LABEL[savedOrder.status] ?? tr('public.store_StoreScreen.received') })}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.primary} />
              </Pressable>
              <IconButton icon="close" size="sm" accessibilityLabel={tr('public.store_StoreScreen.hide_this_order')} onPress={dismissSavedOrder} />
            </View>
          ) : null}
          {!canOrder ? <Notice tone="warning" icon="time-outline" title={blockedTitle}>{blockedBody}</Notice> : null}
          {cartNotice ? (
            <Notice tone="info">
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text variant="small" color={colors.infoText} style={{ flex: 1 }}>{cartNotice}</Text>
                <IconButton icon="close" size="sm" accessibilityLabel={tr('public.store_StoreScreen.dismiss')} onPress={() => setCartNotice(null)} />
              </View>
            </Notice>
          ) : null}
          {tableError && mode === 'QR' ? (
            <Button title={tr('public.store_StoreScreen.check_table_again')} variant="secondary" icon="refresh" onPress={() => void load()} loading={loading} style={{ alignSelf: 'flex-start' }} />
          ) : null}

          {menu.products.length === 0 ? (
            <EmptyState icon="restaurant-outline" title={tr('public.store_StoreScreen.menu_coming_soon')} message={tr('public.store_StoreScreen.name_hasn_t_added_any_items_yet_please', { name: business.name })} />
          ) : sections.length === 0 ? (
            <EmptyState icon="search-outline" title={tr('public.store_StoreScreen.no_matching_items')}
              message={query ? tr('public.store_StoreScreen.nothing_on_the_menu_matches_trim_v', { trim: query.trim(), v: vegOnly ? tr('public.store_StoreScreen.in_veg_items') : '' }) : tr('public.store_StoreScreen.no_vegetarian_items_on_this_menu')}
              action={{ label: tr('common.clear_filters'), icon: 'close', onPress: () => { setQuery(''); setVegOnly(false); } }} />
          ) : (
            visibleSections.map((section) => (
              <View key={section.id} onLayout={(e) => { sectionY.current[section.id] = e.nativeEvent.layout.y; }} style={{ marginTop: 8 }}>
                <View style={styles.sectionHead}>
                  <Text variant="h2" accessibilityRole="header">{section.name}</Text>
                  <Text variant="small" tone="subtle">{section.products.length} {tr('common.item_2')}{section.products.length === 1 ? '' : 's'}</Text>
                </View>
                {section.products.map((p) => (
                  <ProductRow key={p.id} product={p} symbol={symbol} qty={qtyByProduct[p.id] ?? 0} canOrder={canOrder}
                    onAdd={() => onAdd(p)} onChangeQty={(q) => changeProductQty(p, q)} />
                ))}
              </View>
            ))
          )}
          {business.fssai ? <Text variant="small" tone="subtle" align="center" style={{ marginTop: 16 }}>{tr('public.store_StoreScreen.fssai_lic_no')} {business.fssai}</Text> : null}
          <PublicFooter businessName={business.name} />
        </View>
      </ScrollView>

      {cartCount > 0 && canOrder ? (
        <View pointerEvents="box-none" style={[styles.cartBarWrap, { bottom: insets.bottom + 16, paddingHorizontal: pad }]}>
          <Pressable onPress={() => setCartOpen(true)} accessibilityRole="button"
            accessibilityLabel={tr('public.store_StoreScreen.view_cart_cartcount_item_v_price', { cartCount, v: cartCount === 1 ? '' : 's', price: price(cartTotal, symbol) })}
            style={({ hovered, pressed }: any) => [styles.cartBar, shadow(3), {
              borderRadius: radius.lg, backgroundColor: hovered || pressed ? colors.primaryHover : colors.primary, maxWidth: MAX_WIDTH - 2 * pad,
            }, Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}>
            <View style={[styles.cartCount, { backgroundColor: colors.primaryText }]}>
              <Text variant="smallStrong" color={colors.primary}>{cartCount}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="bodyStrong" color={colors.primaryText}>{price(cartTotal, symbol)}</Text>
              <Text variant="caption" color={colors.primaryText} style={{ opacity: 0.85 }}>{business.prices_include_tax ? tr('public.store_StoreScreen.incl_gst') : tr('public.store_StoreScreen.plus_gst')}</Text>
            </View>
            <Text variant="bodyStrong" color={colors.primaryText}>{tr('public.store_StoreScreen.view_cart')}</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.primaryText} />
          </Pressable>
        </View>
      ) : null}

      {!(cartCount > 0 && canOrder) && savedOrder && statusStage(savedOrder.status) !== -1 && !(savedOrder.mode === 'QR' && savedOrder.paid) ? (
        <View pointerEvents="box-none" style={[styles.cartBarWrap, { bottom: insets.bottom + 16, paddingHorizontal: pad }]}>
          <Pressable onPress={() => setView('tracker')} accessibilityRole="button" accessibilityLabel={tr('public.store_StoreScreen.track_order_code', { code: savedOrder.code })}
            style={({ hovered, pressed }: any) => [styles.cartBar, shadow(3), {
              borderRadius: radius.lg, backgroundColor: hovered || pressed ? colors.surfaceSunken : colors.surface, borderWidth: 1, borderColor: colors.primary,
              maxWidth: MAX_WIDTH - 2 * pad,
            }, Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}>
            <Ionicons name="receipt" size={22} color={colors.primary} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text variant="bodyStrong" numberOfLines={1}>{savedOrder.mode === 'QR' ? tr('public.store_StoreScreen.your_bill_code', { code: savedOrder.code }) : tr('public.store_StoreScreen.your_order_code', { code: savedOrder.code })}</Text>
              <Text variant="caption" tone="muted" numberOfLines={1}>
                {savedOrder.mode === 'QR' ? TABLE_STATUS_LABEL[savedOrder.status] ?? tr('common.sent') : STATUS_LABEL[savedOrder.status] ?? tr('public.store_StoreScreen.received')}
              </Text>
            </View>
            <Text variant="bodyStrong" tone="primary">{savedOrder.mode === 'QR' ? tr('public.store_StoreScreen.track_pay') : tr('public.store_StoreScreen.track')}</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.primary} />
          </Pressable>
        </View>
      ) : null}

      <VariantSheet visible={variantOpen} product={variantProduct} symbol={symbol} onClose={() => setVariantOpen(false)}
        onAdd={(variantId, qty) => {
          if (variantProduct) addLine(variantProduct, variantId, qty);
          setVariantOpen(false);
        }} />

      <CartSheet visible={cartOpen} onClose={() => setCartOpen(false)} lines={lines} symbol={symbol}
        pricesIncludeTax={business.prices_include_tax} businessName={business.name} mode={mode} tableLabel={table?.table_number ?? null}
        initialDetails={customer} onChangeQty={setQty}
        payments={qrPayments} defaultPayment={savedOrder?.payment ?? null} existingBill={activeBill}
        onChangeNotes={(key, notes) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, notes } : l)))}
        onClear={() => { setLines([]); setCartOpen(false); }} onPlace={place} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  hero: { alignItems: 'center', paddingBottom: 20, borderBottomWidth: 1 },
  avatar: { width: 56, height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, minHeight: 30, borderRadius: 999 },
  sticky: { borderBottomWidth: 1, paddingBottom: 8 },
  chips: { gap: 8, paddingRight: 8 },
  vegToggle: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 10, borderWidth: 1 },
  track: { width: 30, height: 18, borderRadius: 9, padding: 2, justifyContent: 'center' },
  thumb: { width: 14, height: 14, borderRadius: 7 },
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, paddingTop: 8, paddingBottom: 2 },
  trackBanner: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingRight: 6, borderWidth: 1 },
  trackMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingLeft: 16, minHeight: 56 },
  cartBarWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  cartBar: { width: '100%', flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingHorizontal: 16, paddingVertical: 10 },
  cartCount: { minWidth: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
});
