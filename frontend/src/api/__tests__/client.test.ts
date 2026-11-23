/// <reference types="jest" />
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
import { api, headerJson, headerNumber } from '@/api/client';

const headers = (h: Record<string, string>) => ({ get: (k: string) => h[k] ?? h[k.toLowerCase()] ?? null }) as unknown as Headers;

describe('response headers', () => {
  it('reads paging totals and JSON counts', () => {
    const h = headers({ 'X-Total-Count': '3000', 'X-Counts': '{"Gold":12,"Silver":80,"Bronze":2908,"all":3000}' });
    expect(headerNumber(h, 'X-Total-Count')).toBe(3000);
    expect(headerJson(h, 'X-Counts')).toEqual({ Gold: 12, Silver: 80, Bronze: 2908, all: 3000 });
  });

  it('is undefined when missing or malformed', () => {
    const h = headers({ 'X-Total-Count': 'many', 'X-Counts': '{oops' });
    expect(headerNumber(h, 'X-Total-Count')).toBeUndefined();
    expect(headerJson(h, 'X-Counts')).toBeUndefined();
    expect(headerNumber(headers({}), 'X-Total-Count')).toBeUndefined();
  });

  it('getWithMeta returns the body and the headers; get still returns the body', async () => {
    const realFetch = global.fetch;
    global.fetch = jest.fn(async () => ({
      ok: true, status: 200, text: async () => '[{"id":"c1"}]', headers: headers({ 'X-Total-Count': '1' }),
    })) as unknown as typeof fetch;
    try {
      const { data, headers: h } = await api.getWithMeta<{ id: string }[]>('/crm/customers', { auth: false, baseUrl: 'http://x' });
      expect(data).toEqual([{ id: 'c1' }]);
      expect(headerNumber(h, 'X-Total-Count')).toBe(1);
      expect(await api.get('/crm/customers', { auth: false, baseUrl: 'http://x' })).toEqual([{ id: 'c1' }]);
    } finally {
      global.fetch = realFetch;
    }
  });
});

describe('error messages', () => {
  it('turns the server\'s PAY_BLOCKED_ITEMS into a message in the person\'s language', () => {
    const { ApiError, errorMessage } = jest.requireActual('@/api/client') as typeof import('@/api/client');
    const blocked = new ApiError('2 items not served yet (2 still cooking). Take payment once everything is served.', 409, 'PAY_BLOCKED_ITEMS',
      { level: 'served', order_type: 'DINE_IN', unsent: 0, cooking: 2, ready: 0, blocking: 2 });
    expect(errorMessage(blocked)).toBe('2 items not served yet (2 cooking). Take payment once everything is served.');
    expect(errorMessage(new ApiError('Table not found', 404, 'HTTP_ERROR'))).toBe('Table not found');
  });
});

describe('closed bills', () => {
  it('says a paid / cancelled / merged / part-paid bill clearly, in the person\'s language', () => {
    const { ApiError, errorMessage } = jest.requireActual('@/api/client') as typeof import('@/api/client');
    const closed = (status: string) => new ApiError('server text', 409, 'BILL_CLOSED', { status });
    expect(errorMessage(closed('completed'))).toBe('This bill is paid. Start a new order.');
    expect(errorMessage(closed('cancelled'))).toBe('This bill was cancelled. Start a new order.');
    expect(errorMessage(closed('merged'))).toBe('This bill was merged into another bill. Open that bill instead.');
    expect(errorMessage(new ApiError('server text', 409, 'BILL_PART_PAID', {})))
      .toBe('A payment was already taken on this bill. Collect the rest, or put the new items on a new order.');
  });
});
