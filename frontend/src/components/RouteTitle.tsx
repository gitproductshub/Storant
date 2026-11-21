import React from 'react';
import Head from 'expo-router/head';
import { usePathname } from 'expo-router';
import { pageTitle } from '@/config/brand';

/**
 * Browser tab title (web only): "Storant" on login/home, "<Page name> | Storant" on inner pages.
 * Public pages (privacy, delete-account, online store) set their own title with <PageTitle>.
 */
const NAMES: Record<string, string> = {
  pos: 'Billing', orders: 'Orders', tables: 'Tables', online: 'Online orders', kitchen: 'Kitchen', menu: 'Menu', scan: 'Scan menu',
  inventory: 'Inventory', customers: 'Customers', reports: 'Reports', more: 'More', watch: 'Owner’s watch', offers: 'Offers',
  settings: 'Settings', account: 'Account', billing: 'Plan & billing', brands: 'Brands', business: 'Business', channels: 'Channels',
  emails: 'Emails', floor: 'Floor', modules: 'Modules & plan', printers: 'Printers', qr: 'QR ordering', staff: 'Staff', taxes: 'Taxes',
  admin: 'Console', businesses: 'Businesses', audit: 'Audit log', payments: 'Payments', plans: 'Plans', requests: 'Owner requests', tax: 'Tax',
  subscription: 'Renew plan',
};
const OWN_TITLE = new Set(['privacy', 'delete-account', 'store']);
const ID_LIKE = /^[0-9a-f-]{8,}$|^\d+$/i;

export function titleForPath(pathname: string): string | null | undefined {
  const segs = pathname.split('/').filter(Boolean).filter((s) => !(s.startsWith('(') && s.endsWith(')')));
  if (!segs.length || segs[0] === 'login') return null;
  if (OWN_TITLE.has(segs[0]!)) return undefined;
  const named = segs.filter((s) => !ID_LIKE.test(s));
  const last = named[named.length - 1];
  if (!last) return null;
  if (last === 'signup') return 'Create account';
  return NAMES[last] ?? last.charAt(0).toUpperCase() + last.slice(1).replace(/-/g, ' ');
}

export function RouteTitle() {
  const pathname = usePathname();
  const t = titleForPath(pathname);
  if (t === undefined) return null;
  return <Head><title>{pageTitle(t)}</title></Head>;
}
