/**
 * "Search settings": every setting people look for by a word (gst, upi, printer, swiggy, password…) points at the page
 * and, where a page has sections, the section. Pure data + matching so it is unit-tested.
 */
import type { Ionicons } from '@expo/vector-icons';
import type { SettingsKey, SettingsSection } from './sections';
import { brand } from '@/config/brand';
import { t as tr } from '@/i18n';

export interface SettingsTopic {
  section: SettingsKey;
  title: string;
  /** Where it lives, e.g. "Business › Payments" */
  hint?: string;
  href: string;
  keywords: string;
  icon?: keyof typeof Ionicons.glyphMap;
}

export const SETTINGS_TOPICS: SettingsTopic[] = [
  { section: 'business', get title() { return tr('settings.search.business_profile'); }, get hint() { return tr('common.business'); }, href: '/settings/business?section=profile',
    keywords: 'name shop address phone email contact logo bill header city pincode', icon: 'storefront-outline' },
  { section: 'business', get title() { return tr('settings.search.gstin_fssai_invoices'); }, get hint() { return tr('common.business'); }, href: '/settings/business?section=tax',
    keywords: 'gst gstin fssai invoice bill footer registration composition tax inclusive prices include gst', icon: 'document-text-outline' },
  { section: 'business', get title() { return tr('settings.search.upi_payments'); }, get hint() { return tr('common.business'); }, href: '/settings/business?section=payments',
    keywords: 'upi vpa qr payment gpay phonepe paytm bank pay', icon: 'qr-code-outline' },
  { section: 'business', get title() { return tr('common.loyalty_points'); }, get hint() { return tr('common.business'); }, href: '/settings/business?section=loyalty',
    keywords: 'loyalty points rewards redeem regular customers', icon: 'gift-outline' },
  { section: 'business', get title() { return tr('settings.search.online_store'); }, get hint() { return tr('common.business'); }, href: '/settings/business?section=online',
    keywords: 'online store ordering delivery takeaway website link share poster', icon: 'globe-outline' },
  { section: 'business', get title() { return tr('settings.search.low_stock_level'); }, get hint() { return tr('common.business'); }, href: '/settings/business?section=inventory',
    keywords: 'inventory stock low stock alert threshold', icon: 'cube-outline' },
  { section: 'taxes', get title() { return tr('settings.search.gst_rates_tax_classes'); }, get hint() { return tr('common.gst_taxes'); }, href: '/settings/taxes',
    keywords: 'gst tax rate class hsn sac cgst sgst igst cess 5% 12% 18% 28% rate change slab', icon: 'calculator-outline' },
  { section: 'printers', get title() { return tr('settings.search.receipt_printer'); }, get hint() { return tr('common.printers_receipts'); }, href: '/settings/printers',
    keywords: 'printer print bluetooth thermal receipt bill test print usb pair 58mm 80mm paper width', icon: 'print-outline' },
  { section: 'printers', get title() { return tr('settings.search.kitchen_printer_kot'); }, get hint() { return tr('common.printers_receipts'); }, href: '/settings/printers',
    keywords: 'kot kitchen ticket printer auto print', icon: 'flame-outline' },
  { section: 'printers', get title() { return tr('settings.search.receipt_options'); }, get hint() { return tr('common.printers_receipts'); }, href: '/settings/printers',
    keywords: 'barcode on bill upi qr on bill cash drawer auto print after payment', icon: 'receipt-outline' },
  { section: 'channels', get title() { return tr('settings.search.swiggy_zomato_other_apps'); }, get hint() { return tr('common.sales_channels'); }, href: '/settings/channels',
    keywords: 'swiggy zomato ondc magicpin aggregator channel commission webhook delivery apps price per channel', icon: 'git-network-outline' },
  { section: 'qr', get title() { return tr('common.qr_table_ordering'); }, get hint() { return tr('common.qr_table_ordering'); }, href: '/settings/qr',
    keywords: 'qr table scan dine-in guests order from table poster pay at table', icon: 'qr-code-outline' },
  { section: 'floor', get title() { return tr('settings.search.floor_alert_times'); }, get hint() { return tr('common.floor_alerts'); }, href: '/settings/floor',
    keywords: 'alert alerts amber red late table time kitchen ticket kot delay online order waiting minutes colour color warning', icon: 'alarm-outline' },
  { section: 'brands', get title() { return tr('common.brands'); }, get hint() { return tr('common.brands'); }, href: '/settings/brands',
    keywords: 'brand virtual brand cloud kitchen', icon: 'pricetags-outline' },
  { section: 'staff', get title() { return tr('common.staff_logins'); }, get hint() { return tr('common.staff_roles'); }, href: '/settings/staff',
    keywords: 'staff team users employees cashier waiter kitchen login add staff deactivate password tables assign', icon: 'people-outline' },
  { section: 'staff', get title() { return tr('settings.search.roles_permissions'); }, get hint() { return tr('common.staff_roles'); }, href: '/settings/staff',
    keywords: 'role roles permission permissions access rights custom role manager', icon: 'shield-half-outline' },
  { section: 'staff', get title() { return tr('common.activity_log'); }, get hint() { return tr('common.staff_roles'); }, href: '/settings/staff',
    keywords: 'activity audit log who did what history', icon: 'time-outline' },
  { section: 'emails', get title() { return tr('common.customer_emails'); }, get hint() { return tr('common.customer_emails'); }, href: '/settings/emails',
    keywords: 'email emails template receipt email offer reward mail', icon: 'mail-outline' },
  { section: 'modules', get title() { return tr('settings.search.modules'); }, get hint() { return tr('common.modules_plan'); }, href: '/settings/modules',
    keywords: 'modules features turn off hide inventory kitchen tables customers offers', icon: 'apps-outline' },
  { section: 'billing', get title() { return tr('settings.search.brand_subscription', { brand: brand.name }); }, get hint() { return tr('common.plan_billing'); }, href: '/settings/billing',
    keywords: 'plan subscription renew payment storant invoice trial demo devices upgrade', icon: 'card-outline' },
  { section: 'account', get title() { return tr('common.password'); }, get hint() { return tr('common.account'); }, href: '/settings/account',
    keywords: 'password change password login', icon: 'key-outline' },
  { section: 'account', get title() { return tr('settings.search.appearance'); }, get hint() { return tr('common.account'); }, href: '/settings/account',
    keywords: 'theme dark mode light mode appearance', icon: 'contrast-outline' },
  { section: 'account', get title() { return tr('settings.search.sign_out_delete_account'); }, get hint() { return tr('common.account'); }, href: '/settings/account',
    keywords: 'sign out logout delete account privacy server sync', icon: 'log-out-outline' },
];

function norm(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}%]+/gu, ' ').trim();
}

/**
 * Topics matching the query (every word must match the start of a word in the title, place or keywords), limited to
 * the sections this person can open. Title matches rank first.
 */
export function searchSettings(query: string, sections: Pick<SettingsSection, 'key' | 'label'>[], limit = 8): SettingsTopic[] {
  const words = norm(query).split(' ').filter(Boolean);
  if (!words.length) return [];
  const allowed = new Set(sections.map((s) => s.key));
  const scored: { t: SettingsTopic; score: number }[] = [];
  for (const t of SETTINGS_TOPICS) {
    if (!allowed.has(t.section)) continue;
    const title = norm(t.title);
    const hay = ` ${title} ${norm(t.hint ?? '')} ${norm(t.keywords)}`;
    if (!words.every((w) => hay.includes(` ${w}`))) continue;
    const score = words.reduce((n, w) => n + (` ${title}`.includes(` ${w}`) ? 2 : 1), 0);
    scored.push({ t, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((s) => s.t);
}

/** Sections whose label matches (the left list filters itself as you type). */
export function matchSections<T extends Pick<SettingsSection, 'key' | 'label' | 'description'>>(query: string, sections: T[]): T[] {
  const words = norm(query).split(' ').filter(Boolean);
  if (!words.length) return sections;
  const hits = new Set(searchSettings(query, sections, 50).map((t) => t.section));
  return sections.filter((s) => {
    const hay = ` ${norm(s.label)} ${norm(s.description)}`;
    return hits.has(s.key) || words.every((w) => hay.includes(` ${w}`));
  });
}
