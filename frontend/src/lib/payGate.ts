/**
 * When a bill may be paid — mirrors backend/app/services/order_service.py `pay_gate` so the till disables Pay for the same
 * reason the server would refuse it (the server is still the judge: it answers 409 PAY_BLOCKED_ITEMS).
 *
 * Rules (owner setting `pay_rules`, per order type): "anytime" | "ready" (every kitchen item ready or served) |
 * "served" (every kitchen item served). Defaults: dine-in after served, takeaway / counter / delivery any time.
 * - Only bills taken at the counter (POS) or by table QR are checked; online-store and aggregator orders never are.
 * - Not checked without the Kitchen module, or once the bill has a payment (the rest can always be collected).
 * - Counted by quantity, cancelled lines left out. Items that don't go to the kitchen never count; kitchen items not sent
 *   yet (including new lines in the cart) do; free offer items that were never sent don't.
 * Offline the till can't see the kitchen, so offline bills are never held here (the server accepts them on sync).
 */
import type { OrderItem, OrderType, PayRule } from '@/api/types';
import { t } from '@/i18n';

export const PAY_RULE_DEFAULTS: Record<OrderType, PayRule> = { DINE_IN: 'served', TAKEAWAY: 'anytime', DELIVERY: 'anytime', RETAIL_WALKIN: 'anytime' };
export const GATED_CHANNELS = ['POS', 'QR'];

export interface PayGateInfo {
  level: PayRule;
  unsent: number;
  cooking: number;
  ready: number;
  /** Items that stop the payment; 0 = the bill can be paid. */
  blocking: number;
}

type GateItem = Pick<OrderItem, 'product_id' | 'quantity' | 'kot_id' | 'kitchen_status' | 'is_void' | 'unit_price' | 'notes'> & { is_free?: boolean };

export interface PayGateInput {
  orderType: OrderType | null | undefined;
  channel: string | null | undefined;
  /** Lines already on the bill (a running bill), as the server sent them. */
  items?: GateItem[];
  /** Lines in the cart that will be sent to the kitchen with this payment. */
  newLines?: { productId: string; quantity: number }[];
  rules?: Partial<Record<OrderType, PayRule>> | null;
  /** The Kitchen module is on for this business. */
  kitchenOn: boolean;
  /** The bill already has a payment. */
  paid: boolean;
  online: boolean;
  /** Does this product go to the kitchen (`print_to_kitchen`)? */
  printsToKitchen: (productId: string) => boolean;
}

export function payRuleFor(orderType: OrderType | null | undefined, rules?: Partial<Record<OrderType, PayRule>> | null): PayRule {
  const type = orderType ?? 'TAKEAWAY';
  return rules?.[type] ?? PAY_RULE_DEFAULTS[type] ?? 'anytime';
}

const isVoid = (i: GateItem) => !!i.is_void || i.kitchen_status === 'void' || (i.kitchen_status as string) === 'removed';
const isFree = (i: GateItem) => (typeof i.is_free === 'boolean' ? i.is_free : !i.unit_price && !!i.notes && i.notes.startsWith('Free — '));

export function payGate(input: PayGateInput): PayGateInfo {
  const level = payRuleFor(input.orderType, input.rules);
  const info: PayGateInfo = { level, unsent: 0, cooking: 0, ready: 0, blocking: 0 };
  if (level === 'anytime' || !GATED_CHANNELS.includes(input.channel ?? 'POS') || !input.kitchenOn || input.paid || !input.online) return info;
  for (const i of input.items ?? []) {
    if (isVoid(i)) continue;
    if (!i.kot_id) {
      if (!isFree(i) && input.printsToKitchen(i.product_id)) info.unsent += i.quantity;
      continue;
    }
    const status = i.kitchen_status ?? 'pending';
    if (status === 'pending' || status === 'preparing') info.cooking += i.quantity;
    else if (status === 'ready') info.ready += i.quantity;
  }
  for (const l of input.newLines ?? []) {
    if (input.printsToKitchen(l.productId)) info.unsent += l.quantity;
  }
  info.blocking = info.unsent + info.cooking + (level === 'served' ? info.ready : 0);
  return info;
}

/** "2 items not served yet" — the short reason for the disabled Pay button. */
export function payBlockedTitle(info: Pick<PayGateInfo, 'level' | 'blocking'>): string {
  const n = info.blocking;
  if (info.level === 'ready') return n === 1 ? t('pos.payGate.one_item_not_ready') : t('pos.payGate.n_items_not_ready', { n });
  return n === 1 ? t('pos.payGate.one_item_not_served') : t('pos.payGate.n_items_not_served', { n });
}

/** "1 not sent to the kitchen · 2 cooking · 1 ready to serve" */
export function payBlockedBreakdown(info: PayGateInfo): string {
  return [
    info.unsent ? t('pos.payGate.n_not_sent', { n: info.unsent }) : null,
    info.cooking ? t('pos.payGate.n_cooking', { n: info.cooking }) : null,
    info.ready && info.level === 'served' ? t('pos.payGate.n_ready_to_serve', { n: info.ready }) : null,
  ].filter(Boolean).join(' · ');
}

/** Full sentence for a toast: title, breakdown and what to do. */
export function payBlockedMessage(info: PayGateInfo): string {
  const breakdown = payBlockedBreakdown(info);
  const next = info.level === 'ready' ? t('pos.payGate.take_payment_once_ready') : t('pos.payGate.take_payment_once_served');
  return `${payBlockedTitle(info)}${breakdown ? ` (${breakdown})` : ''}. ${next}`;
}

/** The server's 409 PAY_BLOCKED_ITEMS `details`, if that is what this is. */
export function payGateFromError(error: unknown): PayGateInfo | null {
  const e = error as { code?: unknown; details?: unknown } | null;
  if (!e || e.code !== 'PAY_BLOCKED_ITEMS' || !e.details || typeof e.details !== 'object') return null;
  const d = e.details as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const level = d.level === 'ready' || d.level === 'served' || d.level === 'anytime' ? d.level : 'served';
  return { level, unsent: num(d.unsent), cooking: num(d.cooking), ready: num(d.ready), blocking: num(d.blocking) };
}
