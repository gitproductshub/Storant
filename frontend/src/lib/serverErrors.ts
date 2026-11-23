/**
 * Server errors the app shows in the person's language instead of the server's English (`error.code` from the API's
 * error envelope, backend/app/main.py). Anything else keeps the server's message.
 *
 * - PAY_BLOCKED_ITEMS: the bill's food isn't served / ready yet (pay rules; lib/payGate).
 * - BILL_CLOSED: the bill is paid, cancelled or merged; `details.status` says which.
 * - BILL_PART_PAID: items can't be added to a bill that already has a payment.
 * - INVALID_INDIAN_MOBILE: sign-up / sign-in mobile number isn't 10 digits starting 6-9 (lib/phone.ts).
 */
import { t } from '@/i18n';
import { payBlockedMessage, payGateFromError } from './payGate';

export function billClosedStatus(error: unknown): string | null {
  const e = error as { code?: unknown; details?: unknown } | null;
  if (!e || e.code !== 'BILL_CLOSED') return null;
  const status = (e.details as { status?: unknown } | null | undefined)?.status;
  return typeof status === 'string' ? status : 'completed';
}

/** The localised message for a known error code, or null to keep the server's own message. */
export function localisedServerMessage(error: unknown): string | null {
  const gate = payGateFromError(error);
  if (gate) return payBlockedMessage(gate);
  const closed = billClosedStatus(error);
  if (closed) {
    if (closed === 'merged') return t('pos.billErrors.bill_merged');
    if (closed === 'cancelled') return t('pos.billErrors.bill_cancelled');
    return t('pos.billErrors.bill_paid');
  }
  const e = error as { code?: unknown } | null;
  if (e?.code === 'BILL_PART_PAID') return t('pos.billErrors.bill_part_paid');
  if (e?.code === 'INVALID_INDIAN_MOBILE') return t('common.enter_valid_indian_mobile');
  return null;
}
