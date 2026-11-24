/**
 * Stock on the device: "N left" badges, sold-out tiles and the cart's cap. The server decides every sale
 * (backend app/services/stock_service.py: stock is taken when a line is saved on a bill, under a row lock); these
 * numbers come from /sync/pull, GET /catalog/stock every ~20 s and each bill's response, so offline they are a guide only.
 */
import type { Product } from '@/api/types';
import { t } from '@/i18n';

export interface StockShortItem { product_id: string; name: string; requested?: number; available?: number; sold_out?: boolean }

export type StockMark = { kind: 'out' } | { kind: 'low'; left: number };

/** Are sold-out items refused here? Inventory module on, and the owner hasn't allowed selling at zero. */
export function stockBlocking(features: string[] | null | undefined, allowSellAtZero: boolean | null | undefined): boolean {
  return !!features?.includes('inventory') && !allowSellAtZero;
}

/** Counted stock of a tracked item; null = untracked or never counted (always sells). */
export function stockLeft(p: Pick<Product, 'track_stock' | 'stock'>): number | null {
  return p.track_stock && typeof p.stock === 'number' ? p.stock : null;
}

export function isSoldOut(p: Pick<Product, 'track_stock' | 'stock'>): boolean {
  const left = stockLeft(p);
  return left !== null && left <= 0;
}

/** Badge on a product tile: "Sold out" (only when that blocks a sale), or "N left" at or below the alert level. */
export function stockMark(p: Pick<Product, 'track_stock' | 'stock' | 'low_stock_threshold'>, lowDefault: number, blocking: boolean): StockMark | null {
  const left = stockLeft(p);
  if (left === null) return null;
  if (left <= 0) return blocking ? { kind: 'out' } : null;
  const alert = p.low_stock_threshold ?? lowDefault;
  return left <= alert ? { kind: 'low', left } : null;
}

/**
 * How many more of `p` may go on this bill: null = no limit. `inCart` counts every line of it (all variants share the
 * item's stock).
 */
export function roomFor(p: Pick<Product, 'track_stock' | 'stock'>, inCart: number, blocking: boolean): number | null {
  const left = stockLeft(p);
  if (!blocking || left === null) return null;
  return Math.max(0, left - inCart);
}

/** The short items of a 409 STOCK_SHORT (an ApiError: `code` + `details`), or null for any other error. Reads the
 * shape only, so lib/serverErrors (imported by the API client) can use it without an import cycle. */
export function stockShortFromError(error: unknown): StockShortItem[] | null {
  const e = error as { code?: unknown; details?: unknown } | null;
  if (!e || typeof e !== 'object' || e.code !== 'STOCK_SHORT') return null;
  const items = (e.details as { items?: unknown } | undefined)?.items;
  return Array.isArray(items) ? (items as StockShortItem[]) : [];
}

/** "Masala Chai is sold out." / "Buttermilk: only 2 left." in the person's language. */
export function stockShortMessage(items: StockShortItem[]): string {
  const first = items[0];
  if (!first) return t('stock.sold_out_generic');
  const left = typeof first.available === 'number' ? first.available : 0;
  const one = first.sold_out || left <= 0 ? t('stock.name_sold_out', { name: first.name }) : t('stock.name_only_left', { name: first.name, left });
  return items.length > 1 ? `${one} ${t('stock.more_short', { count: items.length - 1 })}` : one;
}
