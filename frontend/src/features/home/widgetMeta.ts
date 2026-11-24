/**
 * Every Home widget the app knows: its title, icon and the screen it opens. Keep in step with WIDGETS in
 * backend/app/services/dashboard.py (a test checks every key has a title).
 */
import type { Ionicons } from '@expo/vector-icons';
import type { WidgetKey } from '@/api/dashboard';
import { t } from '@/i18n';

type IconName = keyof typeof Ionicons.glyphMap;

export const WIDGET_META: Record<WidgetKey, { icon: IconName; route: string; title: () => string }> = {
  today_sales: { icon: 'cash-outline', route: 'reports', title: () => t('home.widgets.today_sales') },
  open_bills: { icon: 'receipt-outline', route: 'orders', title: () => t('home.widgets.open_bills') },
  payment_claims: { icon: 'qr-code-outline', route: 'tables', title: () => t('home.widgets.payment_claims') },
  ready_to_pay: { icon: 'wallet-outline', route: 'tables', title: () => t('home.widgets.ready_to_pay') },
  ready_to_serve: { icon: 'restaurant-outline', route: 'tables', title: () => t('home.widgets.ready_to_serve') },
  my_tables: { icon: 'grid-outline', route: 'tables', title: () => t('home.widgets.my_tables') },
  kitchen: { icon: 'flame-outline', route: 'kitchen', title: () => t('common.kitchen') },
  low_stock: { icon: 'cube-outline', route: 'inventory', title: () => t('home.widgets.low_stock') },
  my_day: { icon: 'person-outline', route: 'reports', title: () => t('home.widgets.my_day') },
  my_collection: { icon: 'cash-outline', route: 'orders', title: () => t('home.widgets.my_collection') },
  payment_split: { icon: 'pie-chart-outline', route: 'reports', title: () => t('home.widgets.payment_split') },
  hourly_sales: { icon: 'trending-up-outline', route: 'reports', title: () => t('home.widgets.hourly_sales') },
  top_items: { icon: 'podium-outline', route: 'reports', title: () => t('home.widgets.top_items') },
  voids_comps: { icon: 'ban-outline', route: 'watch', title: () => t('home.widgets.voids_comps') },
  floor_live: { icon: 'speedometer-outline', route: 'tables', title: () => t('home.widgets.floor_live') },
  kitchen_delays: { icon: 'alert-circle-outline', route: 'kitchen', title: () => t('home.widgets.kitchen_delays') },
};

/** Widgets that take a whole row on tablets and desktops. */
export const WIDE_WIDGETS: ReadonlySet<WidgetKey> = new Set<WidgetKey>(['hourly_sales']);
