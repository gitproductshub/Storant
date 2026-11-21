/** Wording and small calculations shared by the renewal page, the app-shell banner and Settings → Plan & billing. */
import type { BadgeTone } from '@/components/ui';
import type { SubscriptionState } from '@/api/types';
import type { PaymentMethod, PaymentRequest, SubscriptionPeriod } from '@/api/subscription';
import { formatDate } from '@/lib/format';
import { brand } from '@/config/brand';
import { t, currentLocale } from '@/i18n';

const DAY = 86_400_000;

/** Whole days until `iso` (rounded up, never negative); null when there is no date. */
export function daysUntil(iso: string | null | undefined, now = Date.now()): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - now;
  if (!Number.isFinite(ms)) return null;
  return ms > 0 ? Math.ceil(ms / DAY) : 0;
}

/** Days left, recomputed from the end date so an old snapshot doesn't show a stale count. */
export function liveDaysLeft(sub: SubscriptionState | null | undefined, now = Date.now()): number | null {
  if (!sub || sub.state === 'development') return null;
  return daysUntil(sub.paid_until, now) ?? sub.days_left ?? null;
}

export function daysText(n: number): string {
  if (n <= 0) return 'ends today';
  return n === 1 ? '1 day left' : `${n} days left`;
}

export const STATE_LABEL: Record<SubscriptionState['state'], string> = {
  get trial() { return t('common.free_demo'); },
  get development() { return t('common.development_access'); },
  get active() { return t('common.active'); },
  get grace() { return t('common.payment_due'); },
  get lapsed() { return t('common.ended'); },
};

export const STATE_TONE: Record<SubscriptionState['state'], BadgeTone> = {
  trial: 'info',
  development: 'neutral',
  active: 'success',
  grace: 'warning',
  lapsed: 'danger',
};

export const KIND_LABEL: Record<string, string> = {
  get trial() { return t('common.free_demo'); },
  get paid() { return t('common.paid'); },
  get complimentary() { return t('common.complimentary'); },
  get development() { return t('common.development_access'); },
};

export const METHOD_LABEL: Record<PaymentMethod, string> = {
  upi: 'UPI',
  get bank_transfer() { return t('common.bank_transfer'); },
  get cash() { return t('common.cash'); },
  get card() { return t('common.card'); },
  get cheque() { return t('common.cheque'); },
  get other() { return t('common.other'); },
};

export const REQUEST_STATUS: Record<PaymentRequest['status'], { label: string; tone: BadgeTone }> = {
  pending: { get label() { return t('subscription.format.waiting_for_confirmation'); }, tone: 'warning' },
  approved: { get label() { return t('subscription.format.approved'); }, tone: 'success' },
  rejected: { get label() { return t('subscription.format.not_approved'); }, tone: 'danger' },
};

/** "Your free demo ended on 21 Oct 2026" / "Subscription ended" — headline of the renewal page. */
export function lockHeadline(sub: SubscriptionState | null | undefined): { title: string; subtitle: string } {
  const ended = sub?.paid_until ? formatDate(sub.paid_until) : null;
  if (sub?.kind === 'trial') {
    return {
      title: ended ? t('subscription.format.your_free_demo_ended_on_ended', { ended }) : t('subscription.format.your_free_demo_has_ended'),
      subtitle: t('subscription.format.choose_a_plan_to_keep_billing_with_brand', { brand: brand.name }),
    };
  }
  return {
    title: t('subscription.format.subscription_ended'),
    subtitle: ended
      ? t('subscription.format.your_brand_subscription_ended_on_ended', { brand: brand.name, ended })
      : t('subscription.format.renew_your_brand_subscription_to_switch', { brand: brand.name }),
  };
}

/** Banner line for owners/managers, or null when nothing needs saying. */
export function bannerFor(sub: SubscriptionState | null | undefined, now = Date.now()):
  { tone: 'info' | 'warning' | 'danger'; title: string; detail: string; urgent: boolean } | null {
  if (!sub || sub.locked || sub.state === 'lapsed' || sub.state === 'development') return null;
  const left = liveDaysLeft(sub, now);
  if (sub.state === 'grace') {
    const stops = sub.lock_at ? formatDate(sub.lock_at) : null;
    return { tone: 'danger', title: t('common.payment_due'), detail: stops ? t('subscription.format.access_stops_on_stops', { stops }) : t('subscription.format.renew_to_keep_using_brand', { brand: brand.name }), urgent: true };
  }
  if (sub.state === 'trial') {
    return { tone: left !== null && left <= 3 ? 'warning' : 'info', title: t('common.free_demo'), detail: left === null ? t('subscription.format.renew_any_time') : daysText(left), urgent: left !== null && left <= 3 };
  }
  if (left !== null && left <= 7) {
    return { tone: left <= 3 ? 'warning' : 'info', title: t('subscription.format.subscription_ending'), detail: t('subscription.format.daystext_renew_by_formatdate', { daysText: daysText(left), formatDate: formatDate(sub.paid_until) }), urgent: left <= 3 };
  }
  return null;
}

/** The period that is running now (or the latest one), from GET /subscription history. */
export function currentPeriod(history: SubscriptionPeriod[], now = Date.now()): SubscriptionPeriod | null {
  return history.find((h) => new Date(h.start_date).getTime() <= now && now < new Date(h.end_date).getTime()) ?? history[0] ?? null;
}

export function monthsText(months: number | null | undefined): string {
  if (!months) return '';
  if (months % 12 === 0) return months === 12 ? '1 year' : `${months / 12} years`;
  return months === 1 ? '1 month' : `${months} months`;
}

/** upi://pay link that opens any UPI app with the amount filled in. */
export function upiLink(opts: { upiId: string; payee: string; amount: number | null; note?: string }): string {
  const parts = [`pa=${encodeURIComponent(opts.upiId)}`, `pn=${encodeURIComponent(opts.payee || brand.name)}`];
  if (opts.amount && opts.amount > 0) parts.push(`am=${opts.amount.toFixed(2)}`);
  parts.push('cu=INR');
  if (opts.note) parts.push(`tn=${encodeURIComponent(opts.note.slice(0, 60))}`);
  return `upi://pay?${parts.join('&')}`;
}

/** Readable names for plan feature keys (unknown keys are shown title-cased). */
const FEATURE_LABEL: Record<string, string> = {
  get customers() { return t('subscription.format.customers_crm'); }, get inventory() { return t('common.inventory'); }, get loyalty() { return t('common.loyalty_points'); }, get menu_ocr() { return t('subscription.format.menu_from_a_photo'); }, get offers() { return t('common.offers_rewards'); },
  get reports() { return t('common.reports'); }, get advanced_reports() { return t('subscription.format.advanced_reports'); }, get email() { return t('common.customer_emails'); }, get kitchen() { return t('subscription.format.kitchen_display'); }, get online_store() { return t('subscription.format.online_store'); },
  get qr_ordering() { return t('common.qr_table_ordering'); }, get staff() { return t('common.staff_logins'); }, get tables() { return t('subscription.format.table_management'); }, get audit_log() { return t('common.activity_log'); }, get brands() { return t('subscription.format.cloud_kitchen_brands'); },
  get custom_roles() { return t('subscription.format.custom_roles'); }, get integrations() { return t('subscription.format.swiggy_zomato_integration'); }, get online_orders() { return t('common.online_orders'); },
};

export function featureLabel(key: string): string {
  return FEATURE_LABEL[key] ?? key.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

export function limitsText(limits: Record<string, number | null> | null | undefined): string {
  if (!limits) return '';
  const parts: string[] = [];
  const staff = limits.max_staff;
  const items = limits.max_products;
  const outlets = limits.max_locations;
  parts.push(staff == null ? 'Unlimited staff' : `${staff} staff login${staff === 1 ? '' : 's'}`);
  parts.push(items == null ? 'unlimited items' : `${items.toLocaleString(currentLocale())} items`);
  if (outlets != null && outlets > 1) parts.push(`${outlets} outlets`);
  return parts.join(' · ');
}
