/**
 * Settings → Kitchen rules: when a bill may be paid, per order type (business setting `pay_rules`), and whether the kitchen
 * screen's Bump also marks food served (`bump_marks_served`). Backend: app/api/admin.py, app/core/catalog.py
 * (PAY_RULE_DEFAULTS, ORDER_TYPES_BY_BUSINESS). Pure form logic, unit-tested.
 */
import type { BusinessSettings, BusinessType, OrderType, PayRule } from '@/api/types';
import { PAY_RULE_DEFAULTS } from '@/lib/payGate';

export const PAY_RULES: PayRule[] = ['anytime', 'ready', 'served'];

/** Order types each kind of business uses (counter walk-in is for retail shops only). Same as the server's list. */
export const ORDER_TYPES_BY_BUSINESS: Record<BusinessType, OrderType[]> = {
  restaurant: ['DINE_IN', 'TAKEAWAY', 'DELIVERY'],
  cafe: ['DINE_IN', 'TAKEAWAY', 'DELIVERY'],
  cloud_kitchen: ['TAKEAWAY', 'DELIVERY'],
  retail: ['RETAIL_WALKIN', 'TAKEAWAY', 'DELIVERY'],
};

export interface KitchenRulesForm {
  rules: Record<OrderType, PayRule>;
  bumpMarksServed: boolean;
}

type RulesSettings = Pick<BusinessSettings, 'pay_rules' | 'bump_marks_served' | 'order_types' | 'business_type'>;

/** The order types to show: the server's list for this business, else the built-in list for its type. */
export function orderTypesFor(settings: Partial<RulesSettings> | null | undefined): OrderType[] {
  const fromServer = settings?.order_types?.filter((t): t is OrderType => t in PAY_RULE_DEFAULTS);
  if (fromServer?.length) return fromServer;
  return ORDER_TYPES_BY_BUSINESS[settings?.business_type ?? 'restaurant'] ?? ORDER_TYPES_BY_BUSINESS.restaurant;
}

export function kitchenRulesFormOf(settings: Partial<RulesSettings> | null | undefined): KitchenRulesForm {
  const saved = settings?.pay_rules ?? {};
  const rules = { ...PAY_RULE_DEFAULTS };
  for (const type of Object.keys(PAY_RULE_DEFAULTS) as OrderType[]) {
    const v = saved[type];
    if (v && PAY_RULES.includes(v)) rules[type] = v;
  }
  return { rules, bumpMarksServed: !!settings?.bump_marks_served };
}

/** What to send to PUT /settings: only the order types on screen (the server keeps the others as they are). */
export function kitchenRulesPayload(form: KitchenRulesForm, types: OrderType[]): { pay_rules: Partial<Record<OrderType, PayRule>>; bump_marks_served: boolean } {
  return {
    pay_rules: Object.fromEntries(types.map((t) => [t, form.rules[t]])) as Partial<Record<OrderType, PayRule>>,
    bump_marks_served: form.bumpMarksServed,
  };
}

/** Changed compared with what is saved, looking only at what the screen shows. */
export function kitchenRulesDirty(form: KitchenRulesForm, saved: KitchenRulesForm, types: OrderType[]): boolean {
  return form.bumpMarksServed !== saved.bumpMarksServed || types.some((t) => form.rules[t] !== saved.rules[t]);
}

/** The defaults for the order types on screen: dine-in after served, everything else any time; Bump only clears. */
export function kitchenRulesDefaults(): KitchenRulesForm {
  return { rules: { ...PAY_RULE_DEFAULTS }, bumpMarksServed: false };
}
