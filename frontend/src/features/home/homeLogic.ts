/**
 * Pure helpers for Home (no React): refresh timing, merging the fast and slow refreshes, and the alerts strip.
 */
import type { Ionicons } from '@expo/vector-icons';
import type { Dashboard, WidgetDataMap, WidgetKey } from '@/api/dashboard';
import type { SubscriptionState } from '@/api/types';
import { t } from '@/i18n';

/** Widgets asking for a refresh this often (seconds) or more are "live" and fetched on their own, more often. */
export const LIVE_REFRESH_MAX = 20;
/** The whole dashboard (sales, stock, charts…) is fetched this often. */
export const FULL_REFRESH_MS = 60_000;

/** Refresh as often as the liveliest widget asks, between 15 s and a minute. */
export function pollInterval(data: Pick<Dashboard, 'widgets'> | null): number {
  const asks = (data?.widgets ?? []).map((w) => w.refresh).filter((s) => s > 0);
  const seconds = asks.length ? Math.min(...asks) : 30;
  return Math.min(60, Math.max(15, seconds)) * 1000;
}

/** The live widgets of a dashboard (fetched on their own with `?widgets=`), in a stable order. */
export function liveKeys(data: Pick<Dashboard, 'widgets'> | null): WidgetKey[] {
  return (data?.widgets ?? []).filter((w) => w.refresh > 0 && w.refresh <= LIVE_REFRESH_MAX).map((w) => w.key).sort();
}

/**
 * The full dashboard with the newer live widgets laid over it. The full one decides which widgets exist and their
 * order; a live result only replaces widgets with the same key, and only when it is newer.
 */
export function mergeDashboard(full: Dashboard | null, fullAt: number | null, live: Dashboard | null, liveAt: number | null): Dashboard | null {
  if (!full) return null;
  if (!live || (liveAt ?? 0) <= (fullAt ?? 0)) return full;
  const byKey = new Map(live.widgets.map((w) => [w.key, w]));
  return { ...full, server_time: live.server_time, widgets: full.widgets.map((w) => byKey.get(w.key) ?? w) };
}

export function widgetData<K extends WidgetKey>(data: Pick<Dashboard, 'widgets'> | null, key: K): WidgetDataMap[K] | undefined {
  const w = data?.widgets.find((x) => x.key === key);
  return w && !w.error ? (w.data as WidgetDataMap[K] | undefined) : undefined;
}

export interface HomeAlert {
  key: string;
  tone: 'warning' | 'danger';
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
  /** Screen to open: a tab route name, or "subscription" */
  route: string;
}

/**
 * The few things that need someone now, built only from widgets the person already gets (so nobody sees an alert
 * about something they may not see), plus the owner's plan ending soon.
 */
export function homeAlerts(data: Pick<Dashboard, 'widgets'> | null, opts: { owner: boolean; subscription: SubscriptionState | null }): HomeAlert[] {
  const alerts: HomeAlert[] = [];
  const delays = widgetData(data, 'kitchen_delays');
  if (delays?.late) alerts.push({ key: 'kitchen_late', tone: 'danger', icon: 'flame-outline', text: t('home.alerts.kitchen_late', { count: delays.late }), route: 'kitchen' });
  const floor = widgetData(data, 'floor_live');
  if (floor?.late) alerts.push({ key: 'tables_late', tone: 'danger', icon: 'time-outline', text: t('home.alerts.tables_late', { count: floor.late }), route: 'tables' });
  const serve = widgetData(data, 'ready_to_serve');
  if (serve?.mine) alerts.push({ key: 'ready_for_you', tone: 'warning', icon: 'restaurant-outline', text: t('home.alerts.ready_for_you', { count: serve.mine }), route: 'tables' });
  const claims = widgetData(data, 'payment_claims');
  if (claims?.count) alerts.push({ key: 'claims', tone: 'warning', icon: 'qr-code-outline', text: t('home.alerts.claims', { count: claims.count }), route: 'tables' });
  const bills = widgetData(data, 'open_bills');
  if (bills?.online_waiting) alerts.push({ key: 'online', tone: 'warning', icon: 'bicycle-outline', text: t('home.alerts.online_waiting', { count: bills.online_waiting }), route: 'online' });
  const stock = widgetData(data, 'low_stock');
  if (stock?.out) alerts.push({ key: 'out_of_stock', tone: 'warning', icon: 'cube-outline', text: t('home.alerts.out_of_stock', { count: stock.out }), route: 'inventory' });
  if (stock?.short_orders) {
    alerts.push({ key: 'short_orders', tone: 'danger', icon: 'alert-circle-outline', text: t('home.alerts.short_orders', { count: stock.short_orders }), route: 'inventory' });
  }
  const sub = opts.subscription;
  if (opts.owner && sub && !sub.locked) {
    if (sub.state === 'grace') alerts.push({ key: 'plan_grace', tone: 'danger', icon: 'card-outline', text: t('home.alerts.plan_grace'), route: 'subscription' });
    else if (sub.days_left !== null && sub.days_left <= 7) alerts.push({ key: 'plan_ends', tone: 'warning', icon: 'card-outline', text: t('home.alerts.plan_ends', { count: sub.days_left }), route: 'subscription' });
  }
  return alerts;
}
