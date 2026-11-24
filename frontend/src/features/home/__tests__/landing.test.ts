jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import type { AccessInfo } from '@/api/types';
import { canOpenPath, landingPath } from '../landing';
import { forgetReturnPath, isReturnable, rememberReturnPath, takeReturnPath } from '@/lib/returnTo';
import { pollInterval } from '../homeLogic';

const customRole = (permissions: string[]): AccessInfo => ({
  role: 'menu_only', staff_id: 's1', name: 'Test', permissions, features: ['tables', 'kitchen', 'reports'],
  plan: { key: 'pro', name: 'Pro', limits: {} },
});

describe('landing after sign-in', () => {
  const base = { businessType: 'restaurant' as const, access: null, returnTo: null, startOnKitchenDisplay: false };

  it('sends every business role to Home', () => {
    for (const role of ['owner', 'manager', 'cashier', 'waiter', 'kitchen'] as const) {
      expect(landingPath({ ...base, role })).toBe('/home');
    }
  });

  it('goes back to the page asked for when the role can open it', () => {
    expect(landingPath({ ...base, role: 'owner', returnTo: '/reports' })).toBe('/reports');
    expect(landingPath({ ...base, role: 'waiter', returnTo: '/pos?table=abc' })).toBe('/pos?table=abc');
    expect(landingPath({ ...base, role: 'waiter', returnTo: '/watch' })).toBe('/home'); // owner only
    expect(landingPath({ ...base, role: 'kitchen', returnTo: '/reports' })).toBe('/home');
  });

  it('opens the kitchen display on a device set to start there, if the role can open it', () => {
    expect(landingPath({ ...base, role: 'kitchen', startOnKitchenDisplay: true })).toBe('/kitchen');
    expect(landingPath({ ...base, role: 'owner', businessType: 'retail', startOnKitchenDisplay: true })).toBe('/home');
  });

  it('uses permissions for custom roles', () => {
    const access = customRole(['menu.view']);
    expect(canOpenPath('/settings/account', 'waiter', 'restaurant', access)).toBe(true);
    expect(canOpenPath('/pos', 'waiter', 'restaurant', access)).toBe(false);
    expect(landingPath({ ...base, role: 'waiter', access, returnTo: '/pos' })).toBe('/home');
  });
});

describe('return to the page asked for', () => {
  it('only keeps in-app pages', () => {
    expect(isReturnable('/reports')).toBe(true);
    expect(isReturnable('/pos?table=1')).toBe(true);
    for (const bad of ['/', '/home', '/login', '//evil.example', 'https://evil.example', '/more', null, '']) {
      expect(isReturnable(bad)).toBe(false);
    }
  });

  it('hands the page out once, the same answer while the landing page re-renders', () => {
    rememberReturnPath('/orders');
    expect(takeReturnPath(1_000)).toBe('/orders');
    expect(takeReturnPath(2_000)).toBe('/orders'); // re-render
    expect(takeReturnPath(10_000)).toBeNull();
  });

  it('forgets the page after a sign-out on purpose', () => {
    forgetReturnPath();
    rememberReturnPath('/settings'); // the redirect right after signing out
    expect(takeReturnPath(20_000)).toBeNull();
    rememberReturnPath('/reports'); // later, a real deep link
    expect(takeReturnPath(40_000)).toBe('/reports');
  });
});

describe('Home refresh', () => {
  it('follows the liveliest widget, between 15 s and a minute', () => {
    expect(pollInterval(null)).toBe(30_000);
    const widgets = (refresh: number[]) => ({ widgets: refresh.map((r, i) => ({ key: 'kitchen' as const, refresh: r, data: undefined, id: i })) });
    expect(pollInterval(widgets([60, 15, 300]) as never)).toBe(15_000);
    expect(pollInterval(widgets([5]) as never)).toBe(15_000);
    expect(pollInterval(widgets([300]) as never)).toBe(60_000);
  });
});
