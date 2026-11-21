import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useTheme } from '@/theme/ThemeProvider';
import { ActionMenu, Button, Divider, ErrorState, Loading, StatusPill, Text, confirm, prompt, toast, type ActionMenuItem } from '@/components/ui';
import { ordersApi } from '@/api/endpoints';
import { errorMessage } from '@/api/client';
import type { Order } from '@/api/types';
import type { OpsOrder } from '@/api/floor';
import { useApi } from '@/hooks/useApi';
import { useAuth, can } from '@/store/auth';
import { useData } from '@/store/data';
import { useBadges } from '@/store/badges';
import { isCompItem, isVoidItem, kotFromOrder, printBill, printErrorMessage, printKitchenTicket } from '@/lib/billing';
import { PaymentClaimBanner } from './PaymentClaim';
import { formatDateTime, money } from '@/lib/format';
import { ORDER_TYPE_UI, PAYMENT_UI } from '@/lib/uiLabels';
import { Notice, billNo, billText, channelLabel, itemCount, shareText } from './common';
import { paymentPillStatus } from './floorLogic';
import { t as tr } from '@/i18n';

/**
 * Full bill view. Primary actions (settle / add items, reprint, cancel) are always visible;
 * everything else sits in an anchored ActionMenu. Shows the list copy instantly and refreshes it from the server.
 */
export function OrderDetail({ orderId, initial, onChanged, onClose }: {
  orderId: string; initial?: Order | null; onChanged?: (o: Order) => void; onClose?: () => void;
}) {
  const { colors, radius } = useTheme();
  const role = useAuth((s) => s.session?.role ?? null);
  const settings = useData((s) => s.settings);
  const sym = settings?.currency_symbol ?? '₹';
  const { data, error, loading, reload, setData } = useApi(() => ordersApi.get(orderId), [orderId]);
  // A light list row (no lines) can't stand in for the bill: wait for the server copy then
  const order = (data ?? (initial && initial.id === orderId && Array.isArray(initial.items) ? initial : null)) as OpsOrder | null;
  const [busy, setBusy] = useState<string | null>(null);

  if (!order) {
    if (loading) return <Loading label={tr('ops.OrderDetail.loading_bill')} />;
    return <ErrorState message={error ?? tr('ops.OrderDetail.bill_not_found')} onRetry={reload} />;
  }

  const running = order.status === 'open';
  const isNew = order.status === 'placed';
  const closed = order.status === 'cancelled' || order.status === 'merged';
  const canCancel = can(role, 'manage') && !closed;
  const canSettle = running && can(role, 'bill') && order.balance_due > 0;
  const voided = order.items.filter(isVoidItem);
  const comped = order.items.filter((i) => !isVoidItem(i) && isCompItem(i));
  const compValue = comped.reduce((s, i) => s + (i.comp_value ?? 0), 0);
  const tableLabel = order.table_label;
  const pay = paymentPillStatus(order);
  const sentToKitchen = order.items.some((i) => i.sent_to_kitchen && !isVoidItem(i));

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };

  const onPrint = () => run('print', async () => {
    try {
      await printBill(order, settings, { duplicate: order.status === 'completed' });
    } catch (e) {
      toast.error(printErrorMessage(e));
    }
  });

  const onPrintKot = () => run('kot', async () => {
    try {
      await printKitchenTicket(kotFromOrder(order));
    } catch (e) {
      toast.error(printErrorMessage(e));
    }
  });

  const onShare = () => run('share', async () => {
    try {
      await shareText(billText(order, settings?.business_name ?? 'Bill', sym), `Bill ${billNo(order)}`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  });

  const onCancel = () => run('cancel', async () => {
    const reason = await prompt({
      title: order.status === 'completed' ? tr('ops.OrderDetail.void_this_bill') : tr('ops.OrderDetail.cancel_this_order'),
      message: tr('ops.OrderDetail.enter_a_reason_it_is_saved_with_the_bill'),
      label: tr('common.reason'), placeholder: tr('ops.OrderDetail.e_g_customer_left_wrong_order'), confirmLabel: tr('common.continue'), danger: true, minLength: 3,
    });
    if (!reason) return;
    const ok = await confirm({
      title: tr('ops.OrderDetail.v_bill_billno', { v: order.status === 'completed' ? tr('ops.OrderDetail.void') : tr('common.cancel'), billNo: billNo(order) }),
      message: `${money(order.total_amount, sym)} will be removed from sales${order.status === 'completed' ? ' and stock will be returned' : ''}.`
        + (order.paid_amount > 0 ? ` ${money(order.paid_amount, sym)} was already collected — refund it to the customer.` : '')
        + ' This can\'t be undone.',
      confirmLabel: order.status === 'completed' ? tr('ops.OrderDetail.void_bill') : tr('ops.OrderDetail.cancel_order'), danger: true,
    });
    if (!ok) return;
    try {
      const updated = await ordersApi.cancel(order.id, reason);
      const merged = { ...updated, table_label: updated.table_label ?? order.table_label };
      setData(merged);
      onChanged?.(merged);
      void useBadges.getState().refresh();
      toast.success(tr('ops.OrderDetail.bill_billno_cancelled', { billNo: billNo(order) }));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  });

  const openInPos = () => {
    onClose?.();
    router.push({ pathname: '/pos', params: { order: order.id } });
  };

  const more: ActionMenuItem[] = [
    { key: 'add', label: tr('ops.OrderDetail.add_items'), icon: 'add-circle-outline', hidden: !running || !can(role, 'order') || !canSettle, onPress: openInPos },
    { key: 'pos', label: tr('common.open_in_billing'), icon: 'receipt-outline', hidden: !running || !can(role, 'order'),
      description: tr('ops.OrderDetail.split_move_items_discount_comp'), onPress: openInPos },
    { key: 'online', label: tr('ops.OrderDetail.review_in_online_orders'), icon: 'bicycle-outline', hidden: !isNew, onPress: () => { onClose?.(); router.push('/online'); } },
    { key: 'kot', label: tr('ops.OrderDetail.reprint_kot'), icon: 'flame-outline', hidden: !sentToKitchen || closed, onPress: onPrintKot },
    { key: 'share', label: tr('ops.OrderDetail.share_bill'), icon: 'share-social-outline', description: tr('ops.OrderDetail.whatsapp_sms_or_copy'), onPress: onShare },
  ];

  return (
    <View style={{ gap: 16 }}>
      {/* Header */}
      <View style={{ gap: 8 }}>
        <View style={styles.rowBetween}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text variant="h2" numberOfLines={1}>{tr('common.bill')} {billNo(order)}</Text>
            <Text variant="small" tone="muted" numberOfLines={1}>{formatDateTime(order.created_at)}{order.invoice_no ? tr('ops.OrderDetail.order_code', { code: order.code }) : ''}</Text>
          </View>
          <Text variant="moneyLarge" numberOfLines={1} style={order.status === 'cancelled' ? styles.strike : undefined}>{money(order.total_amount, sym)}</Text>
        </View>
        <View style={styles.wrapRow}>
          <StatusPill status={order.status} size="md" />
          {pay ? <StatusPill status={pay} size="md" label={pay === 'claim' ? tr('common.upi_to_confirm') : undefined} /> : null}
          <StatusPill status="type" label={ORDER_TYPE_UI[order.type] ?? order.type} showIcon={false} />
          {order.channel !== 'POS' ? <StatusPill status="channel" label={channelLabel(order.channel)} showIcon={false} /> : null}
          {tableLabel ? <StatusPill status="table" label={tr('ops.OrderDetail.table_tablelabel_v', { tableLabel, v: order.bill_label ? ` · ${order.bill_label}` : '' })} showIcon={false} /> : null}
          {!tableLabel && order.bill_label ? <StatusPill status="bill" label={order.bill_label} showIcon={false} /> : null}
          {order.guests ? <StatusPill status="guests" label={tr('ops.OrderDetail.guests_guest_v', { guests: order.guests, v: order.guests === 1 ? '' : 's' })} showIcon={false} /> : null}
          {order.token_no ? <StatusPill status="token" label={tr('ops.OrderDetail.token_token_no', { token_no: order.token_no })} showIcon={false} /> : null}
          {order.waiter_name ? <StatusPill status="waiter" label={order.waiter_name} showIcon={false} /> : null}
        </View>
      </View>

      {/* Primary actions: one tap, always in the same place */}
      <View style={styles.wrapRow}>
        {canSettle ? (
          <Button title={tr('ops.OrderDetail.settle_money', { money: money(order.balance_due, sym) })} icon="wallet-outline" variant="success" onPress={openInPos} />
        ) : running && can(role, 'order') ? (
          <Button title={tr('ops.OrderDetail.add_items')} icon="add" onPress={openInPos} />
        ) : isNew ? (
          <Button title={tr('ops.OrderDetail.review_order')} icon="bicycle-outline" onPress={() => { onClose?.(); router.push('/online'); }} />
        ) : null}
        {order.status !== 'merged' ? (
          <Button title={order.status === 'completed' ? tr('ops.OrderDetail.reprint') : tr('common.print_bill')} icon="print-outline" variant="outline"
            onPress={onPrint} loading={busy === 'print'} disabled={!!busy} />
        ) : null}
        {canCancel ? (
          <Button title={order.status === 'completed' ? tr('ops.OrderDetail.void_2') : tr('ops.OrderDetail.cancel_2')} icon="close-circle-outline" variant="dangerOutline"
            onPress={onCancel} loading={busy === 'cancel'} disabled={!!busy} />
        ) : null}
        <ActionMenu items={more} align="end" title={tr('ops.OrderDetail.more_for_this_bill')}
          trigger={(open) => <Button icon="ellipsis-horizontal" variant="outline" accessibilityLabel={tr('ops.OrderDetail.more_actions_for_this_bill')} onPress={open} />} />
      </View>

      <PaymentClaimBanner order={order} currency={sym} onChanged={(updated) => { setData(updated); onChanged?.(updated); void useBadges.getState().refresh(); }} />

      {order.status === 'cancelled' && order.cancel_reason ? (
        <Notice tone="danger" title={tr('common.cancelled')} message={order.cancel_reason} />
      ) : null}
      {order.status === 'merged' ? (
        <Notice tone="neutral" icon="git-merge-outline" title={tr('common.merged')}
          message={tr('ops.OrderDetail.v_this_bill_isn_t_counted_as_a_sale_or_a', { v: order.cancel_reason ?? tr('ops.OrderDetail.its_items_were_moved_to_another_bill') })} />
      ) : null}
      {voided.length || comped.length ? (
        <View style={styles.wrapRow}>
          {voided.length ? <StatusPill status="void" label={tr('ops.OrderDetail.reduce_cancelled_after_ordering', { reduce: voided.reduce((s, i) => s + i.quantity, 0) })} /> : null}
          {comped.length ? <StatusPill status="ready" label={tr('ops.OrderDetail.on_the_house_money', { money: money(compValue, sym) })} /> : null}
        </View>
      ) : null}
      {error && data === null ? <Notice tone="warning" message={tr('ops.OrderDetail.showing_saved_copy_error', { error })} /> : null}

      {/* Customer */}
      {order.customer_name || order.customer_phone || order.delivery_address || order.external_order_id ? (
        <View style={[styles.box, { backgroundColor: colors.surfaceSunken, borderRadius: radius.md }]}>
          {order.customer_name || order.customer_phone ? (
            <Text variant="bodyStrong" numberOfLines={1}>
              {order.customer_name ?? tr('common.customer')}{order.customer_phone ? <Text tone="muted">  {order.customer_phone}</Text> : null}
            </Text>
          ) : null}
          {order.delivery_address ? <Text variant="small" tone="muted" numberOfLines={3}>{order.delivery_address}</Text> : null}
          {order.external_order_id ? <Text variant="small" tone="muted" numberOfLines={1}>{channelLabel(order.channel)} {tr('ops.OrderDetail.order_id')} {order.external_order_id}</Text> : null}
        </View>
      ) : null}

      {/* Items */}
      <View style={{ gap: 2 }}>
        <Text variant="caption" tone="subtle" style={styles.caps}>{itemCount(order)} {tr('common.item_2')}{itemCount(order) === 1 ? '' : 's'}</Text>
        {order.items.length === 0 ? <Text tone="muted">{tr('ops.OrderDetail.no_items_on_this_bill_yet')}</Text> : null}
        {order.items.map((i) => {
          const isVoid = isVoidItem(i);
          const comp = !isVoid && isCompItem(i);
          const kitchen = running && !isVoid && i.kitchen_status ? i.kitchen_status : null;
          return (
            <View key={i.id} style={[styles.itemRow, { borderBottomColor: colors.divider }]}>
              <Text variant="bodyStrong" tone={isVoid ? 'danger' : 'default'} style={[{ width: 34 }, isVoid && styles.strike]}>{i.quantity}×</Text>
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Text variant="body" tone={isVoid ? 'danger' : 'default'} numberOfLines={2} style={isVoid ? styles.strike : undefined}>
                  {i.name}{i.variant_name ? <Text tone={isVoid ? 'danger' : 'muted'}> · {i.variant_name}</Text> : null}
                </Text>
                {isVoid ? (
                  <Text variant="small" tone="danger" numberOfLines={2}>{tr('common.cancelled')}{i.void_reason ? ` · ${i.void_reason}` : ''} {tr('ops.OrderDetail.not_charged')}</Text>
                ) : comp ? (
                  <Text variant="small" tone="success" numberOfLines={2}>{tr('common.on_the_house')}{i.comp_reason ? ` · ${i.comp_reason}` : ''}</Text>
                ) : (
                  <Text variant="small" tone="subtle" numberOfLines={1}>
                    {tr('ops.OrderDetail.money_each', { money: money(i.unit_price, sym) })}{i.tax_rate ? tr('ops.OrderDetail.gst_tax_rate', { tax_rate: i.tax_rate }) : ''}
                  </Text>
                )}
                {kitchen ? <StatusPill status={kitchen} /> : null}
                {i.notes ? <Text variant="small" tone="warning" numberOfLines={2}>{tr('ops.OrderDetail.note')} {i.notes}</Text> : null}
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                {isVoid ? (
                  <Text variant="money" tone="subtle" numberOfLines={1} style={styles.strike}>{money(i.unit_price * i.quantity, sym)}</Text>
                ) : comp ? (
                  <>
                    <Text variant="money" tone="success" numberOfLines={1}>{money(0, sym)}</Text>
                    {i.comp_value ? <Text variant="small" tone="subtle" style={styles.strike}>{money(i.comp_value, sym)}</Text> : null}
                  </>
                ) : (
                  <Text variant="money" numberOfLines={1}>{money(i.line_total, sym)}</Text>
                )}
              </View>
            </View>
          );
        })}
      </View>

      {/* Totals */}
      <View style={{ gap: 6 }}>
        <Line label={tr('ops.OrderDetail.subtotal')} value={money(order.subtotal, sym)} />
        {order.discount_amount ? <Line label={tr('common.discount')} value={`-${money(order.discount_amount, sym)}`} tone="success" /> : null}
        {order.tax_breakup.length ? order.tax_breakup.map((t) => (
          <View key={t.rate} style={{ gap: 2 }}>
            <Line label={tr('ops.OrderDetail.cgst_v_on_money', { v: t.rate / 2, money: money(t.taxable, sym) })} value={money(t.cgst, sym)} small />
            <Line label={tr('ops.OrderDetail.sgst_v', { v: t.rate / 2 })} value={money(t.sgst, sym)} small />
          </View>
        )) : order.tax_amount ? <Line label="GST" value={money(order.tax_amount, sym)} /> : null}
        {order.round_off ? <Line label={tr('common.round_off')} value={money(order.round_off, sym)} small /> : null}
        <Divider />
        <Line label={tr('common.total')} value={money(order.total_amount, sym)} strong />
        {order.paid_amount > 0 && order.balance_due > 0 ? <Line label={tr('ops.OrderDetail.paid_so_far')} value={money(order.paid_amount, sym)} /> : null}
        {order.balance_due > 0 && !closed ? <Line label={tr('ops.OrderDetail.balance_due')} value={money(order.balance_due, sym)} tone="danger" strong /> : null}
        {order.commission_amount ? <Line label={tr('ops.OrderDetail.aggregator_commission')} value={`-${money(order.commission_amount, sym)}`} small /> : null}
      </View>

      {/* Payments */}
      {order.payments.length ? (
        <View style={{ gap: 6 }}>
          <Text variant="caption" tone="subtle" style={styles.caps}>{tr('common.payments')}</Text>
          {order.payments.map((p) => (
            <View key={p.id} style={styles.rowBetween}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text variant="body" numberOfLines={1}>{PAYMENT_UI[p.method] ?? p.method}</Text>
                {p.reference ? <Text variant="small" tone="subtle" numberOfLines={1}>{tr('ops.OrderDetail.ref')} {p.reference}</Text> : null}
              </View>
              <Text variant="money">{money(p.amount, sym)}</Text>
            </View>
          ))}
          {order.settled_by_name ? <Text variant="small" tone="subtle">{tr('ops.OrderDetail.settled_by')} {order.settled_by_name}</Text> : null}
        </View>
      ) : null}

      {/* Loyalty */}
      {order.loyalty_points_earned || order.loyalty_points_redeemed ? (
        <View style={styles.wrapRow}>
          {order.loyalty_points_earned ? <StatusPill status="brand" label={tr('ops.OrderDetail.loyalty_points_earned_points_earned', { loyalty_points_earned: order.loyalty_points_earned })} /> : null}
          {order.loyalty_points_redeemed ? <StatusPill status="brand" label={tr('ops.OrderDetail.loyalty_points_redeemed_points_redeemed', { loyalty_points_redeemed: order.loyalty_points_redeemed })} /> : null}
        </View>
      ) : null}

      {order.notes ? <Notice tone="neutral" icon="chatbox-ellipses-outline" title={tr('ops.OrderDetail.order_note')} message={order.notes} /> : null}
      {order.completed_at ? <Text variant="small" tone="subtle">{tr('common.completed')} {formatDateTime(order.completed_at)}</Text> : null}
    </View>
  );
}

function Line({ label, value, strong, small, tone }: { label: string; value: string; strong?: boolean; small?: boolean; tone?: 'success' | 'danger' }) {
  const variant = strong ? 'h3' : small ? 'small' : 'body';
  return (
    <View style={styles.rowBetween}>
      <Text variant={variant} tone={tone ?? (small ? 'muted' : 'default')} numberOfLines={1} style={{ flex: 1 }}>{label}</Text>
      <Text variant={strong ? 'h3' : small ? 'small' : 'money'} tone={tone ?? (small ? 'muted' : 'default')} numberOfLines={1}
        style={{ fontVariant: ['tabular-nums'] }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  box: { padding: 12, gap: 4 },
  itemRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 10, borderBottomWidth: 1 },
  caps: { textTransform: 'uppercase' },
  strike: { textDecorationLine: 'line-through' },
});
