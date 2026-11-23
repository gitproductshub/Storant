/// <reference types="jest" />
import type { OrderItem } from '@/api/types';
import { payBlockedMessage, payBlockedTitle, payGate, payGateFromError, payRuleFor, type PayGateInput } from '../payGate';

const item = (id: string, over: Partial<OrderItem> = {}): OrderItem => ({
  id, product_id: `p-${id}`, variant_id: null, name: id, variant_name: null, quantity: 1, unit_price: 100, tax_rate: 5, tax_amount: 5,
  line_total: 100, notes: null, sent_to_kitchen: true, kot_id: 'k1', kitchen_status: 'pending', ...over,
});

const kitchenProducts = new Set(['p-dal', 'p-roti', 'p-new', 'p-later']);
const base = (over: Partial<PayGateInput> = {}): PayGateInput => ({
  orderType: 'DINE_IN', channel: 'POS', items: [], newLines: [], rules: null, kitchenOn: true, paid: false, online: true,
  printsToKitchen: (id) => kitchenProducts.has(id), ...over,
});

describe('pay rules (mirrors the server)', () => {
  it('defaults: dine-in after served, everything else any time', () => {
    expect(payRuleFor('DINE_IN')).toBe('served');
    expect(payRuleFor('TAKEAWAY')).toBe('anytime');
    expect(payRuleFor('DELIVERY')).toBe('anytime');
    expect(payRuleFor('RETAIL_WALKIN')).toBe('anytime');
    expect(payRuleFor('DINE_IN', { DINE_IN: 'ready' })).toBe('ready');
  });

  it('counts what still has to reach the table, by quantity', () => {
    const items = [
      item('dal', { quantity: 2, kitchen_status: 'pending' }),
      item('roti', { quantity: 3, kitchen_status: 'ready' }),
      item('paneer', { kitchen_status: 'served' }),
      item('gone', { kitchen_status: 'void', is_void: true }),
      item('later', { kot_id: null, kitchen_status: null, sent_to_kitchen: false }), // a kitchen item kept back
      item('cola', { kot_id: null, kitchen_status: null, sent_to_kitchen: false }), // never goes to the kitchen
      item('freebie', { kot_id: null, kitchen_status: null, unit_price: 0, is_free: true, product_id: 'p-new' }),
    ];
    const info = payGate(base({ items, newLines: [{ productId: 'p-new', quantity: 1 }, { productId: 'p-cola', quantity: 4 }] }));
    expect(info).toEqual({ level: 'served', unsent: 2, cooking: 2, ready: 3, blocking: 7 });
  });

  it('"after ready" lets ready food through', () => {
    const items = [item('dal', { kitchen_status: 'ready' }), item('roti', { kitchen_status: 'preparing' })];
    expect(payGate(base({ items, rules: { DINE_IN: 'ready' } })).blocking).toBe(1);
    expect(payGate(base({ items: [item('dal', { kitchen_status: 'ready' })], rules: { DINE_IN: 'ready' } })).blocking).toBe(0);
  });

  it('never holds takeaway, aggregator, part-paid, offline or kitchen-less bills', () => {
    const items = [item('dal')];
    expect(payGate(base({ items })).blocking).toBe(1);
    expect(payGate(base({ items, orderType: 'TAKEAWAY' })).blocking).toBe(0);
    expect(payGate(base({ items, channel: 'SWIGGY' })).blocking).toBe(0);
    expect(payGate(base({ items, channel: 'QR' })).blocking).toBe(1); // table QR dine-in is checked
    expect(payGate(base({ items, paid: true })).blocking).toBe(0);
    expect(payGate(base({ items, online: false })).blocking).toBe(0);
    expect(payGate(base({ items, kitchenOn: false })).blocking).toBe(0);
    expect(payGate(base({ items, rules: { DINE_IN: 'anytime' } })).blocking).toBe(0);
  });
});

describe('messages', () => {
  it('says how many items are holding the bill', () => {
    expect(payBlockedTitle({ level: 'served', blocking: 2 })).toBe('2 items not served yet');
    expect(payBlockedTitle({ level: 'served', blocking: 1 })).toBe('1 item not served yet');
    expect(payBlockedTitle({ level: 'ready', blocking: 3 })).toBe('3 items not ready yet');
    expect(payBlockedMessage({ level: 'served', unsent: 1, cooking: 2, ready: 1, blocking: 4 }))
      .toBe('4 items not served yet (1 not sent to the kitchen · 2 cooking · 1 ready to serve). Take payment once everything is served.');
  });

  it('reads the server\'s 409 PAY_BLOCKED_ITEMS', () => {
    const err = { code: 'PAY_BLOCKED_ITEMS', details: { level: 'served', order_type: 'DINE_IN', unsent: 0, cooking: 2, ready: 0, blocking: 2 } };
    expect(payGateFromError(err)).toEqual({ level: 'served', unsent: 0, cooking: 2, ready: 0, blocking: 2 });
    expect(payGateFromError({ code: 'HTTP_ERROR', details: 'x' })).toBeNull();
    expect(payGateFromError(null)).toBeNull();
  });
});
