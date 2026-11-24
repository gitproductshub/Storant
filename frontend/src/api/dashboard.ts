/**
 * Home dashboard (backend/app/api/dashboard.py, app/services/dashboard.py). The server decides which widgets a person
 * gets from their permissions, the plan and the business type, and leaves money out for people who may not see it —
 * so every money field here is optional.
 */
import { api } from './client';
import type { BusinessType } from './types';

export type Persona = 'owner' | 'manager' | 'cashier' | 'waiter' | 'kitchen' | 'basic';

export interface TodaySales { orders: number; gross_sales: number; average_order_value: number }
export interface OpenBills {
  count: number; value?: number; online_waiting: number; tables_occupied?: number; tables_total?: number; oldest_at: string | null;
}
export interface ClaimBill { order_id: string; code: string; table_label: string | null; bill_label: string | null; method: string | null; amount?: number; at: string | null }
export interface PaymentClaims { count: number; bills: ClaimBill[] }
export interface PayBill { order_id: string; code: string; table_label: string | null; bill_label: string | null; total?: number; since: string | null }
export interface ReadyToPay { count: number; value?: number; bills: PayBill[] }
export interface ServeItem {
  order_id: string; table_id: string; table_label: string; bill_label: string | null; kot_no: number | null; ready_count: number;
  ready_since: string | null; mine: boolean;
}
export interface ReadyToServeWidget { count: number; mine: number; oldest_ready_since: string | null; server_time: string | null; items: ServeItem[] }
export interface KitchenCounts { pending: number; preparing: number; ready: number; served: number }
export interface MyTable {
  table_id: string; label: string; section: string | null; assigned: boolean; bills: number; since: string | null; kitchen: KitchenCounts;
}
export interface MyTables { assigned: number; running: number; tables: MyTable[] }
export interface KitchenWidget {
  pending: number; preparing: number; ready: number; oldest_at: string | null;
  to_prepare: { name: string; variant: string | null; quantity: number }[];
}
export interface LowStock { count: number; out: number }
export interface MyDay {
  orders: number; tables_served: number; covers: number; items: number; bills_settled: number; cancelled: number;
  sales?: number; collected?: number; average_bill?: number;
}
export interface MyCollection { total: number; count: number; by_method: { method: string; amount: number; count: number }[] }

// Dashboard insights (plan feature "dashboard_insights")
export interface PaymentSplit { total: number; by_method: { method: string; amount: number; count: number }[] }
export interface HourlySales { hourly: number[]; peak_hour: number | null }
export interface TopItems { items: { name: string; quantity: number; revenue: number }[] }
/** Counts for everyone who gets the card; the ₹ values only for the owner. */
export interface VoidsComps {
  cancelled_bills: number; items_cancelled: number; items_removed: number; on_the_house: number; discounted_bills: number;
  cancelled_bills_value?: number; items_cancelled_value?: number; items_removed_value?: number; on_the_house_value?: number; discount_value?: number;
}

// Live monitor (plan feature "dashboard_live"); minutes come from Settings → Kitchen rules / floor alerts
export interface FloorLive {
  total: number; occupied: number; free: number; warn: number; late: number; amber_min: number; red_min: number;
  longest: { table_label: string; since: string | null } | null;
}
export interface KitchenDelays {
  cooking: number; warn: number; late: number; amber_min: number; red_min: number;
  oldest: { kot_no: number | null; table_label: string | null; token_no: number | null; since: string | null } | null;
}

export interface WidgetDataMap {
  today_sales: TodaySales;
  open_bills: OpenBills;
  payment_claims: PaymentClaims;
  ready_to_pay: ReadyToPay;
  ready_to_serve: ReadyToServeWidget;
  my_tables: MyTables;
  kitchen: KitchenWidget;
  low_stock: LowStock;
  my_day: MyDay;
  my_collection: MyCollection;
  payment_split: PaymentSplit;
  hourly_sales: HourlySales;
  top_items: TopItems;
  voids_comps: VoidsComps;
  floor_live: FloorLive;
  kitchen_delays: KitchenDelays;
}
export type WidgetKey = keyof WidgetDataMap;

/** One widget: its data, or an error message when only this widget couldn't be loaded. */
export interface DashboardWidget<K extends WidgetKey = WidgetKey> { key: K; refresh: number; data?: WidgetDataMap[K]; error?: string }

export interface Dashboard {
  persona: Persona;
  business_type: BusinessType;
  server_time: string;
  day: { from: string; to: string };
  widgets: DashboardWidget[];
  /** Widgets the plan doesn't include (owner only, for the one "more on a higher plan" card). */
  locked: WidgetKey[];
}

export const dashboardApi = {
  get: (widgets?: string[]) => api.get<Dashboard>('/dashboard', widgets?.length ? { query: { widgets: widgets.join(',') } } : undefined),
};
