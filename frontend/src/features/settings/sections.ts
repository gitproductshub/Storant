import type { Ionicons } from '@expo/vector-icons';
import type { AccessInfo, Role } from '@/api/types';
import { hasAccess } from '@/store/access';
import { t } from '@/i18n';

export type SettingsKey = 'overview' | 'business' | 'taxes' | 'printers' | 'channels' | 'qr' | 'floor' | 'kitchen' | 'brands' | 'staff' | 'emails' | 'modules' | 'billing' | 'account';

export interface SettingsSection {
  key: SettingsKey;
  href: string;
  label: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  roles: Role[];
  /** Once /access/me has loaded these decide (any permission + the module); before that, `roles` */
  permissions?: string[];
  feature?: string;
  ownerOnly?: boolean;
}

const ALL: Role[] = ['owner', 'manager', 'cashier', 'waiter', 'kitchen'];
const MANAGERS: Role[] = ['owner', 'manager'];

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { key: 'overview', href: '/settings', get label() { return t('common.overview'); }, get description() { return t('settings.sections.setup_checklist_and_app_details'); }, icon: 'grid-outline', roles: ALL },
  { key: 'business', href: '/settings/business', get label() { return t('common.business'); }, get description() { return t('settings.sections.profile_upi_loyalty_online_ordering'); }, icon: 'storefront-outline', roles: MANAGERS,
    permissions: ['settings.manage'] },
  { key: 'taxes', href: '/settings/taxes', get label() { return t('common.gst_taxes'); }, get description() { return t('settings.sections.tax_classes_cgst_sgst_rate_changes'); }, icon: 'calculator-outline', roles: MANAGERS,
    permissions: ['settings.manage'] },
  { key: 'printers', href: '/settings/printers', get label() { return t('common.printers_receipts'); }, get description() { return t('settings.sections.bluetooth_printers_paper_size_test_print'); }, icon: 'print-outline', roles: ALL },
  { key: 'channels', href: '/settings/channels', get label() { return t('common.sales_channels'); }, get description() { return t('settings.sections.swiggy_zomato_ondc_magicpin_qr_store'); }, icon: 'git-network-outline', roles: MANAGERS,
    permissions: ['channels.manage'] },
  { key: 'qr', href: '/settings/qr', get label() { return t('common.qr_table_ordering'); }, get description() { return t('settings.sections.guests_scan_order_and_pay_from_their_table'); }, icon: 'qr-code-outline',
    roles: MANAGERS, permissions: ['settings.manage'] },
  { key: 'floor', href: '/settings/floor', get label() { return t('common.floor_alerts'); }, get description() { return t('settings.sections.when_tables_kitchen_tickets_and_online'); },
    icon: 'alarm-outline', roles: MANAGERS, permissions: ['settings.manage'] },
  { key: 'kitchen', href: '/settings/kitchen', get label() { return t('settings.KitchenRulesScreen.kitchen_rules'); }, get description() { return t('settings.sections.when_bills_can_be_paid_and_what_bump_does'); },
    icon: 'restaurant-outline', roles: ['owner'], ownerOnly: true },
  { key: 'brands', href: '/settings/brands', get label() { return t('common.brands'); }, get description() { return t('settings.sections.virtual_brands_for_cloud_kitchens'); }, icon: 'pricetags-outline', roles: MANAGERS,
    permissions: ['settings.manage'] },
  { key: 'staff', href: '/settings/staff', get label() { return t('common.staff_roles'); }, get description() { return t('settings.sections.team_logins_permissions_waiter'); }, icon: 'people-outline', roles: MANAGERS,
    permissions: ['staff.view', 'staff.manage', 'audit.view'] },
  { key: 'emails', href: '/settings/emails', get label() { return t('common.customer_emails'); }, get description() { return t('settings.sections.reward_offer_and_receipt_email_templates'); }, icon: 'mail-outline', roles: MANAGERS,
    permissions: ['email.manage'], feature: 'email' },
  { key: 'modules', href: '/settings/modules', get label() { return t('common.modules_plan'); }, get description() { return t('settings.sections.your_plan_and_the_modules_you_use'); }, icon: 'apps-outline', roles: ['owner'],
    ownerOnly: true },
  { key: 'billing', href: '/settings/billing', get label() { return t('common.plan_billing'); }, get description() { return t('settings.sections.your_subscription_renewal_and_payments'); }, icon: 'card-outline', roles: ['owner'],
    ownerOnly: true },
  { key: 'account', href: '/settings/account', get label() { return t('common.account'); }, get description() { return t('settings.sections.profile_password_appearance_sign_out'); }, icon: 'person-circle-outline', roles: ALL },
];

export function sectionsFor(role: Role | null, access: AccessInfo | null = null): SettingsSection[] {
  if (!role) return [];
  return SETTINGS_SECTIONS.filter((s) => {
    if (s.ownerOnly) return role === 'owner';
    if (!s.permissions && !s.feature) return true;
    return hasAccess(access, { permissions: s.permissions, feature: s.feature }) ?? s.roles.includes(role);
  });
}

export const ROLE_LABEL: Record<Role, string> = {
  get owner() { return t('common.owner'); }, get manager() { return t('settings.sections.manager'); }, get cashier() { return t('settings.sections.cashier'); }, get waiter() { return t('common.waiter'); }, get kitchen() { return t('common.kitchen'); },
};

export const ROLE_DESCRIPTION: Record<Role, string> = {
  owner: 'Everything, including staff, settings, reports and closing the business account.',
  manager: 'Runs the shop: menu, stock, reports, settings and cashier/waiter/kitchen logins.',
  cashier: 'Takes orders, collects payment, prints bills and manages customers.',
  waiter: 'Takes table orders and sends them to the kitchen. Cannot take payment.',
  kitchen: 'Sees the kitchen display and marks tickets as preparing or ready.',
};
