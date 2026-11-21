import { t } from '@/i18n';

/**
 * Translated labels for the screens. `ORDER_TYPE_LABEL`, `CHANNEL_LABEL` and `PAYMENT_LABEL` in `lib/format.ts`
 * stay English on purpose: receipts, kitchen tickets and printed reports are always printed in English.
 * Getters keep these tables in step with the active language.
 */
export const ORDER_TYPE_UI: Record<string, string> = {
  get DINE_IN() { return t('labels.order_type.DINE_IN'); },
  get TAKEAWAY() { return t('labels.order_type.TAKEAWAY'); },
  get DELIVERY() { return t('labels.order_type.DELIVERY'); },
  get RETAIL_WALKIN() { return t('labels.order_type.RETAIL_WALKIN'); },
};

export const CHANNEL_UI: Record<string, string> = {
  get POS() { return t('labels.channel.POS'); },
  get QR() { return t('labels.channel.QR'); },
  get ONLINE() { return t('labels.channel.ONLINE'); },
  get SWIGGY() { return t('labels.channel.SWIGGY'); },
  get ZOMATO() { return t('labels.channel.ZOMATO'); },
  get ONDC() { return t('labels.channel.ONDC'); },
  get MAGICPIN() { return t('labels.channel.MAGICPIN'); },
  get OTHER() { return t('labels.channel.OTHER'); },
};

export const PAYMENT_UI: Record<string, string> = {
  get CASH() { return t('labels.payment.CASH'); },
  get CARD() { return t('labels.payment.CARD'); },
  get UPI() { return t('labels.payment.UPI'); },
  get WALLET() { return t('labels.payment.WALLET'); },
  get AGGREGATOR() { return t('labels.payment.AGGREGATOR'); },
  get CREDIT() { return t('labels.payment.CREDIT'); },
  get OTHER() { return t('labels.payment.OTHER'); },
};
