jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import { isSoldOut, roomFor, stockBlocking, stockLeft, stockMark, stockShortFromError, stockShortMessage } from '@/lib/stock';
import { localisedServerMessage } from '@/lib/serverErrors';
import { fitToStock } from '../stockCart';

const item = (stock: number | null, track = true, low: number | null = null) => ({ track_stock: track, stock, low_stock_threshold: low });

describe('stock on the device', () => {
  it('blocks only with the Inventory module on and selling at zero not allowed', () => {
    expect(stockBlocking(['inventory'], false)).toBe(true);
    expect(stockBlocking(['inventory'], true)).toBe(false);
    expect(stockBlocking(['tables'], false)).toBe(false);
    expect(stockBlocking(null, false)).toBe(false);
  });

  it('never limits untracked or never-counted items', () => {
    expect(stockLeft(item(5, false))).toBeNull();
    expect(stockLeft(item(null))).toBeNull();
    expect(roomFor(item(null), 99, true)).toBeNull();
    expect(isSoldOut(item(null))).toBe(false);
  });

  it('shows "N left" at or below the alert level and "Sold out" only when it blocks', () => {
    expect(stockMark(item(2), 10, true)).toEqual({ kind: 'low', left: 2 });
    expect(stockMark(item(20), 10, true)).toBeNull();
    expect(stockMark(item(3, true, 2), 10, true)).toBeNull(); // own alert level
    expect(stockMark(item(-4), 10, true)).toEqual({ kind: 'out' });
    expect(stockMark(item(0), 10, false)).toBeNull();
  });

  it('counts what is already on the bill (all variants of the item)', () => {
    expect(roomFor(item(2), 0, true)).toBe(2);
    expect(roomFor(item(2), 2, true)).toBe(0);
    expect(roomFor(item(2), 5, true)).toBe(0);
    expect(roomFor(item(2), 5, false)).toBeNull();
  });

  it('reads STOCK_SHORT and says it in the person\'s language', () => {
    const err = { code: 'STOCK_SHORT', details: { items: [{ product_id: 'p', name: 'Buttermilk', requested: 3, available: 2 }] } };
    expect(stockShortFromError(err)).toHaveLength(1);
    expect(stockShortFromError({ code: 'BILL_CLOSED' })).toBeNull();
    expect(stockShortMessage([{ product_id: 'p', name: 'Buttermilk', available: 2 }])).toContain('2');
    expect(stockShortMessage([{ product_id: 'p', name: 'Masala Chai', available: 0 }])).toContain('Masala Chai');
    expect(localisedServerMessage(err)).toContain('Buttermilk');
  });
});

describe('fix the bill to what is left', () => {
  const lines = [
    { id: 'a', productId: 'chai', quantity: 2 },
    { id: 'b', productId: 'lassi', quantity: 1 },
    { id: 'c', productId: 'chai', quantity: 3 },
  ];
  it('shrinks the newest lines first and removes what reaches zero', () => {
    expect(fitToStock(lines, 'chai', 2)).toEqual([['c', 0]]); // 5 → 2: the newest line (3) goes
    expect(fitToStock(lines, 'chai', 4)).toEqual([['c', 2]]);
    expect(fitToStock(lines, 'chai', 0)).toEqual([['c', 0], ['a', 0]]);
    expect(fitToStock(lines, 'chai', 9)).toEqual([]);
  });
});
