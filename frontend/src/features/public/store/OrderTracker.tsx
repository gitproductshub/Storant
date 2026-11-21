import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme/ThemeProvider';
import { Button, Card, Text } from '@/components/ui';
import { publicApi } from '@/api/endpoints';
import { ApiError } from '@/api/client';
import { formatTime, money } from '@/lib/format';
import { statusStage, type PlacedOrder, type PublicOrderStatus } from './model';
import { t } from '@/i18n';

const POLL_MS = 10_000;

const STEPS: { title: string; body: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { get title() { return t('public.store_OrderTracker.received'); }, get body() { return t('public.store_OrderTracker.the_shop_has_your_order'); }, icon: 'receipt-outline' },
  { get title() { return t('public.store_OrderTracker.accepted'); }, get body() { return t('public.store_OrderTracker.your_order_is_being_prepared'); }, icon: 'flame-outline' },
  { get title() { return t('common.completed'); }, get body() { return t('public.store_OrderTracker.enjoy_thank_you_for_ordering'); }, icon: 'checkmark-done-outline' },
];

/** Live status of a placed order. Polls every 10 s until it is completed or cancelled. */
export function OrderTracker({ tenantId, order, symbol, businessName, phone, onBack, onStatus }: {
  tenantId: string; order: PlacedOrder; symbol: string; businessName: string; phone: string | null;
  onBack: () => void; /** Called whenever the status changes ('missing' if the order no longer exists). */ onStatus: (status: string) => void;
}) {
  const { colors, radius } = useTheme();
  const [status, setStatus] = useState<PublicOrderStatus | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [failing, setFailing] = useState(false);
  const [checking, setChecking] = useState(false);
  const mounted = useRef(true);

  const current = status?.status ?? order.status;
  const stage = statusStage(current);
  const final = stage === 2 || stage === -1;

  const load = useCallback(async () => {
    setChecking(true);
    try {
      const s = (await publicApi.orderStatus(tenantId, order.id)) as PublicOrderStatus;
      if (!mounted.current) return;
      setStatus(s);
      setUpdatedAt(new Date());
      setFailing(false);
    } catch (e) {
      if (!mounted.current) return;
      // A 404 means the order no longer exists (e.g. the business closed); stop pretending to track it
      if (e instanceof ApiError && e.status === 404) onStatus('missing');
      setFailing(true);
    } finally {
      if (mounted.current) setChecking(false);
    }
  }, [tenantId, order.id, onStatus]);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => { mounted.current = false; };
  }, [load]);

  useEffect(() => {
    onStatus(current);
  }, [current, onStatus]);

  useEffect(() => {
    if (final) return undefined;
    const id = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(id);
  }, [final, load]);

  const token = status?.token_no ?? order.token_no;
  const total = status?.total_amount ?? order.total_amount;

  return (
    <View style={{ gap: 16 }}>
      <Card style={{ alignItems: 'center', gap: 10, paddingVertical: 28 }} elevated>
        <View style={[styles.heroIcon, { backgroundColor: stage === -1 ? colors.dangerSoft : colors.successSoft }]}>
          <Ionicons name={stage === -1 ? 'close' : stage === 2 ? 'checkmark-done' : 'checkmark'} size={32} color={stage === -1 ? colors.danger : colors.success} />
        </View>
        <Text variant="h1" align="center" accessibilityRole="header">
          {stage === -1 ? t('public.store_OrderTracker.order_cancelled') : stage === 2 ? t('public.store_OrderTracker.order_completed') : stage === 1 ? t('public.store_OrderTracker.order_accepted') : t('public.store_OrderTracker.order_placed')}
        </Text>
        <Text tone="muted" align="center" style={{ maxWidth: 420 }}>
          {stage === -1
            ? t('public.store_OrderTracker.businessname_couldn_t_take_this_order_if', { businessName })
            : order.mode === 'QR'
              ? t('public.store_OrderTracker.we_ve_sent_your_order_to_the_kitchen_v', { v: order.tableLabel ? t('public.store_OrderTracker.for_table_tablelabel', { tableLabel: order.tableLabel }) : '' })
              : order.orderType === 'DELIVERY'
                ? t('public.store_OrderTracker.businessname_has_received_your_order_and', { businessName })
                : t('public.store_OrderTracker.businessname_has_received_your_order_show', { businessName })}
        </Text>
        <View style={[styles.codeBox, { backgroundColor: colors.surfaceSunken, borderRadius: radius.lg }]}>
          {token ? (
            <View style={{ alignItems: 'center' }}>
              <Text variant="caption" tone="subtle" style={{ textTransform: 'uppercase' }}>{t('public.store_OrderTracker.token')}</Text>
              <Text variant="display" style={{ fontSize: 40, lineHeight: 46 }} accessibilityLabel={t('public.store_OrderTracker.token_number_token', { token })}>{token}</Text>
            </View>
          ) : null}
          <View style={{ alignItems: 'center' }}>
            <Text variant="caption" tone="subtle" style={{ textTransform: 'uppercase' }}>{t('public.store_OrderTracker.order')}</Text>
            <Text variant={token ? 'h3' : 'h1'} selectable>#{status?.code ?? order.code}</Text>
          </View>
        </View>
      </Card>

      {stage !== -1 ? (
        <Card style={{ gap: 0 }}>
          {STEPS.map((step, i) => {
            const done = stage >= i;
            const active = stage === i && !final;
            return (
              <View key={step.title} style={styles.step} accessibilityLabel={`${step.title}${done ? t('public.store_OrderTracker.done') : ''}`}>
                <View style={{ alignItems: 'center' }}>
                  <View style={[styles.stepDot, {
                    backgroundColor: done ? colors.primary : colors.surface,
                    borderColor: done ? colors.primary : colors.borderStrong,
                  }]}>
                    <Ionicons name={done ? 'checkmark' : step.icon} size={16} color={done ? colors.primaryText : colors.textSubtle} />
                  </View>
                  {i < STEPS.length - 1 ? <View style={[styles.stepLine, { backgroundColor: stage > i ? colors.primary : colors.border }]} /> : null}
                </View>
                <View style={{ flex: 1, paddingBottom: i < STEPS.length - 1 ? 18 : 0 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text variant="bodyStrong" tone={done ? 'default' : 'subtle'}>{step.title}</Text>
                    {active ? <View style={[styles.live, { backgroundColor: colors.success }]} /> : null}
                  </View>
                  <Text variant="small" tone={done ? 'muted' : 'subtle'}>{step.body}</Text>
                </View>
              </View>
            );
          })}
        </Card>
      ) : null}

      <Card style={{ gap: 10 }}>
        <Text variant="h3">{t('public.store_OrderTracker.order_summary')}</Text>
        {(status?.items ?? []).map((item, i) => (
          <View key={i} style={styles.itemRow}>
            <Text tone="muted" style={{ minWidth: 28, fontVariant: ['tabular-nums'] }}>{item.quantity}×</Text>
            <Text style={{ flex: 1 }}>{item.name}{item.variant_name ? <Text tone="muted"> · {item.variant_name}</Text> : null}</Text>
          </View>
        ))}
        {!status ? <Text tone="subtle" variant="small">{t('public.store_OrderTracker.loading_items')}</Text> : null}
        <View style={[styles.itemRow, { borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: 10, marginTop: 4 }]}>
          <Text variant="bodyStrong" style={{ flex: 1 }}>{t('public.store_OrderTracker.total_incl_taxes')}</Text>
          <Text variant="money">{money(total, symbol)}</Text>
        </View>
        {status?.payment_status === 'paid' ? <Text variant="small" tone="success">{t('common.paid')}</Text> : <Text variant="small" tone="muted">{order.mode === 'QR' ? t('public.store_OrderTracker.ask_for_the_bill_at_your_table_or_pay_at') : order.orderType === 'DELIVERY' ? t('public.store_OrderTracker.pay_when_your_order_is_delivered') : t('public.store_OrderTracker.pay_at_the_counter_when_you_collect')}</Text>}
      </Card>

      <View style={styles.meta}>
        <Ionicons name={failing ? 'cloud-offline-outline' : 'sync-outline'} size={14} color={failing ? colors.warningText : colors.textSubtle} />
        <Text variant="small" tone={failing ? 'warning' : 'subtle'}>
          {failing ? t('public.store_OrderTracker.can_t_reach_the_shop_right_now_we_ll_keep')
            : final ? t('public.store_OrderTracker.last_updated_v', { v: updatedAt ? formatTime(updatedAt.toISOString()) : '' })
              : t('public.store_OrderTracker.updates_automatically_v', { v: updatedAt ? t('public.store_OrderTracker.checked_formattime', { formatTime: formatTime(updatedAt.toISOString()) }) : '' })}
        </Text>
      </View>

      <View style={styles.actions}>
        {!final ? <Button title={t('common.refresh')} variant="secondary" icon="refresh" onPress={() => void load()} loading={checking} /> : null}
        {phone ? <Button title={t('public.store_OrderTracker.call_shop')} variant="secondary" icon="call-outline" onPress={() => void Linking.openURL(`tel:${phone.replace(/\s/g, '')}`).catch(() => {})} /> : null}
        <Button title={final ? t('public.store_OrderTracker.back_to_menu') : t('public.store_OrderTracker.order_more')} icon="restaurant-outline" onPress={onBack} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  heroIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  codeBox: { flexDirection: 'row', gap: 28, alignItems: 'center', justifyContent: 'center', paddingVertical: 14, paddingHorizontal: 24, marginTop: 8 },
  step: { flexDirection: 'row', gap: 14 },
  stepDot: { width: 32, height: 32, borderRadius: 16, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  stepLine: { width: 2, flex: 1, minHeight: 18, marginVertical: 2 },
  live: { width: 8, height: 8, borderRadius: 4 },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center' },
  actions: { flexDirection: 'row', gap: 10, justifyContent: 'center', flexWrap: 'wrap' },
});
