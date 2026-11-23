/**
 * Indian mobile numbers for sign-up and sign-in: exactly 10 digits, first digit 6, 7, 8 or 9. Same rule as the server
 * (backend/app/core/phone.py), which also enforces it. Business, customer and receipt phone fields don't use this
 * (a shop may have a landline).
 *
 * Typing / pasting: spaces, dashes, dots and brackets are ignored; a leading +91 or 91 is dropped only when that leaves
 * exactly 10 digits (12 in all); a single leading 0 only when there are 11; then it stops at 10 digits. So a real number
 * such as 9198765432 is never shortened.
 */
import { t } from '@/i18n';

export const INDIAN_MOBILE = /^[6-9]\d{9}$/;

/** What the field keeps from typed or pasted text: up to 10 digits, +91 / 91 / 0 dropped as described above. */
export function normalizeMobileInput(raw: string): string {
  let digits = String(raw ?? '').replace(/[\s\-().]/g, '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return digits.slice(0, 10);
}

export function isIndianMobile(digits: string): boolean {
  return INDIAN_MOBILE.test(digits);
}

/**
 * The inline error for a number being typed: wrong first digit straight away; too short once the person is done
 * (`final`: on blur / submit). Null = fine so far.
 */
export function mobileError(digits: string, opts: { final?: boolean } = {}): string | null {
  if (!digits) return opts.final ? t('common.enter_valid_indian_mobile') : null;
  if (/^[0-5]/.test(digits) || /\D/.test(digits)) return t('common.enter_valid_indian_mobile');
  if (opts.final && digits.length < 10) return t('common.enter_valid_indian_mobile');
  return null;
}

/** Login "Email or phone": the first character decides — a digit or + means a phone number; a letter means an email. */
export function startsLikePhone(text: string): boolean {
  const s = String(text ?? '').trimStart();
  return /^[0-9+]/.test(s) && !/[a-zA-Z@]/.test(s);
}
