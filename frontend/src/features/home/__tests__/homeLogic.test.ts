jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import type { Dashboard, DashboardWidget } from '@/api/dashboard';
import { homeAlerts, liveKeys, mergeDashboard } from '../homeLogic';
import { WIDE_WIDGETS, WIDGET_META } from '../widgetMeta';

const dash = (widgets: DashboardWidget[], server_time = '2026-11-24T10:00:00Z'): Dashboard => ({
  persona: 'owner', business_type: 'restaurant', server_time, day: { from: '', to: '' }, widgets, locked: [],
});

describe('Home refresh groups', () => {
  const full = dash([
    { key: 'today_sales', refresh: 60, data: { orders: 2, gross_sales: 300, average_order_value: 150 } },
    { key: 'kitchen', refresh: 15, data: { pending: 1, preparing: 0, ready: 0, oldest_at: null, to_prepare: [] } },
    { key: 'open_bills', refresh: 20, data: { count: 1, online_waiting: 0, oldest_at: null } },
    { key: 'low_stock', refresh: 300, data: { count: 0, out: 0 } },
  ]);

  it('fetches only the live widgets on the fast cycle', () => {
    expect(liveKeys(full)).toEqual(['kitchen', 'open_bills']);
    expect(liveKeys(null)).toEqual([]);
  });

  it('lays newer live widgets over the full dashboard, keeping its order', () => {
    const live = dash([{ key: 'kitchen', refresh: 15, data: { pending: 4, preparing: 1, ready: 0, oldest_at: null, to_prepare: [] } }], '2026-11-24T10:00:15Z');
    const merged = mergeDashboard(full, 1_000, live, 2_000)!;
    expect(merged.widgets.map((w) => w.key)).toEqual(['today_sales', 'kitchen', 'open_bills', 'low_stock']);
    expect((merged.widgets[1].data as { pending: number }).pending).toBe(4);
    expect(mergeDashboard(full, 3_000, live, 2_000)).toBe(full); // the full one is newer
    expect(mergeDashboard(null, null, live, 2_000)).toBeNull();
  });
});

describe('Home alerts', () => {
  it('come only from widgets the person gets', () => {
    const data = dash([
      { key: 'kitchen_delays', refresh: 15, data: { cooking: 3, warn: 1, late: 2, amber_min: 10, red_min: 20, oldest: null } },
      { key: 'payment_claims', refresh: 20, data: { count: 1, bills: [] } },
      { key: 'low_stock', refresh: 300, data: { count: 4, out: 0 } },
    ]);
    expect(homeAlerts(data, { owner: false, subscription: null }).map((a) => a.key)).toEqual(['kitchen_late', 'claims']);
    expect(homeAlerts(null, { owner: true, subscription: null })).toEqual([]);
  });

  it('tells only the owner when the plan is ending', () => {
    const sub = { state: 'active' as const, paid_until: null, days_left: 3, locked: false };
    expect(homeAlerts(dash([]), { owner: true, subscription: sub }).map((a) => a.key)).toEqual(['plan_ends']);
    expect(homeAlerts(dash([]), { owner: false, subscription: sub })).toEqual([]);
    expect(homeAlerts(dash([]), { owner: true, subscription: { ...sub, days_left: null } })).toEqual([]);
    expect(homeAlerts(dash([]), { owner: true, subscription: { ...sub, state: 'grace' } }).map((a) => a.key)).toEqual(['plan_grace']);
  });

  it('a renderer and a title for every widget', () => {
    const keys = Object.keys(WIDGET_META);
    expect(keys).toHaveLength(16);
    for (const k of keys) expect(WIDGET_META[k as keyof typeof WIDGET_META].title()).toBeTruthy();
    expect(WIDE_WIDGETS.has('hourly_sales')).toBe(true);
  });
});
