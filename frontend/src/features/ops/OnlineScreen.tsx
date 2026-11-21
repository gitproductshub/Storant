/**
 * Online orders inbox (docs/20_High_Volume_UX.md): Swiggy, Zomato, QR tables and the online store in one place.
 * - New orders: chime + highlight, channel, external id and time waiting (amber / red after the business's Floor alert time, 3 / 6 min by default).
 * - Big Accept / Reject on the card; Accept sends the KOT and, with "Auto-print KOT" on, prints it — no dialogs.
 * - QR orders show the table, guest and how they said they'd pay; UPI claims are confirmed inline.
 * Refreshes every 5 s while visible.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import {
  ActionMenu, Button, Card, Divider, ErrorState, FilterBar, IconButton, Screen, Skeleton, StatusPill, Text, prompt, toast,
  type ActionMenuItem,
} from '@/components/ui';
import { ordersApi } from '@/api/endpoints';
import { errorMessage } from '@/api/client';
import { opsApi, paymentClaimOf, type OpsOrder } from '@/api/floor';
import { useAuth, can } from '@/store/auth';
import { useData } from '@/store/data';
import { useBadges } from '@/store/badges';
import { usePrefs } from '@/store/prefs';
import { kotFromOrder, printBill, printErrorMessage, printKitchenTicket } from '@/lib/billing';
import { formatTime, money } from '@/lib/format';
import { ORDER_TYPE_UI } from '@/lib/uiLabels';
import { AGGREGATOR_CODES, ChannelTile, Grid, Notice, channelLabel } from './common';
import { PaymentClaimBanner, payChoice } from './PaymentClaim';
import { ageTone, freshIds, minutesBetween, pruneMarks, type AgeThresholds } from './floorLogic';
import { useFloorAges } from './useFloorAges';
import { playAlert, useDevicePref, useLivePoll, useNow } from '@/hooks/live';
import { AgeChip, GroupTitle, LiveStatus, ageColors } from './parts';
import { t } from '@/i18n';

const POLL_MS = 5_000;
const NEW_GLOW_MS = 60_000;

export default function OnlineScreen() {
  const { colors } = useTheme();
  const { isPhone, isDesktop } = useLayout();
  const role = useAuth((s) => s.session?.role ?? null);
  const channels = useData((s) => s.channels);
  const autoPrintKot = usePrefs((s) => s.autoPrintKot);
  const now = useNow(10_000);
  const ages = useFloorAges();
  const [sound, setSound] = useDevicePref<boolean>('online.sound', true);
  const [showInfo, setShowInfo] = useDevicePref<boolean>('online.aggregatorInfo', true);
  const [channel, setChannel] = useState<string>('all');
  const [glow, setGlow] = useState<Record<string, number>>({});

  const poll = useLivePoll(async () => {
    const [placed, open] = await Promise.all([
      opsApi.orders({ status: 'placed', limit: 100 }),
      opsApi.orders({ status: 'open', limit: 100 }),
    ]);
    return {
      // oldest first: whoever has waited longest is served first
      incoming: [...placed.items].reverse(),
      incomingTotal: placed.total,
      progress: open.items.filter((o) => o.channel !== 'POS').reverse(),
    };
  }, [], POLL_MS);
  const { data, error, loading, reload, silentReload } = poll;

  // Chime + highlight when a new order arrives (not on first load)
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!data) return;
    const ids = data.incoming.map((o) => o.id);
    const fresh = freshIds(seen.current, ids);
    if (fresh.length) {
      const at = Date.now();
      setGlow((g) => ({ ...pruneMarks(g, at, NEW_GLOW_MS), ...Object.fromEntries(fresh.map((id) => [id, at])) }));
      if (sound) playAlert('online');
      toast.info(fresh.length === 1 ? t('ops.OnlineScreen.new_online_order') : t('ops.OnlineScreen.length_new_online_orders', { length: fresh.length }));
      void useBadges.getState().refresh();
    }
    seen.current = new Set([...(seen.current ?? []), ...ids]);
  }, [data, sound]);

  const aggregators = useMemo(() => channels.filter((c) => c.enabled && AGGREGATOR_CODES.includes(c.code)), [channels]);
  const changed = () => {
    void silentReload();
    void useBadges.getState().refresh();
  };

  const incomingAll = data?.incoming ?? [];
  const progressAll = data?.progress ?? [];
  const channelCounts = useMemo(() => {
    const m: Record<string, number> = {};
    [...incomingAll, ...progressAll].forEach((o) => { m[o.channel] = (m[o.channel] ?? 0) + 1; });
    return m;
  }, [incomingAll, progressAll]);
  const match = (o: OpsOrder) => channel === 'all' || o.channel === channel;
  const incoming = incomingAll.filter(match);
  const progress = progressAll.filter(match);
  const waitingLong = incoming.filter((o) => ageTone(minutesBetween(o.created_at, now), ages.online) !== 'ok').length;

  const filters = [
    { key: 'all', label: t('common.all'), count: incomingAll.length + progressAll.length },
    ...Object.keys(channelCounts).sort().map((c) => ({ key: c, label: channelLabel(c), count: channelCounts[c] })),
  ];

  const newMenu: ActionMenuItem[] = aggregators.length ? aggregators.map((c) => ({
    key: c.code, label: c.name || channelLabel(c.code), icon: c.code === 'OTHER' ? 'call-outline' : 'bicycle-outline',
    description: c.commission_pct ? t('ops.OnlineScreen.commission_pct_commission_v', { commission_pct: c.commission_pct, v: c.price_adjust_pct ? t('ops.OnlineScreen.prices_v_price_adjust_pct', { v: c.price_adjust_pct > 0 ? '+' : '', price_adjust_pct: c.price_adjust_pct }) : '' }) : undefined,
    onPress: () => router.push({ pathname: '/pos', params: { channel: c.code } }),
  })) : [{
    key: 'none', label: t('ops.OnlineScreen.turn_on_delivery_apps'), icon: 'settings-outline', description: t('ops.OnlineScreen.settings_sales_channels'),
    disabled: !can(role, 'manage'), disabledReason: t('ops.OnlineScreen.ask_a_manager_to_turn_on_swiggy_or_zomato_x'), onPress: () => router.push('/settings'),
  }];

  const liveToggles = (
    <>
      <Button title={t('ops.OnlineScreen.auto_print_kot')} icon={autoPrintKot ? 'checkbox' : 'square-outline'} variant={autoPrintKot ? 'tonal' : 'outline'}
        accessibilityLabel={t('ops.OnlineScreen.auto_print_kot_when_accepting_v', { v: autoPrintKot ? 'on' : 'off' })}
        onPress={() => { usePrefs.getState().set({ autoPrintKot: !autoPrintKot }); toast.info(autoPrintKot ? t('ops.OnlineScreen.kots_won_t_print_automatically') : t('ops.OnlineScreen.kots_print_as_soon_as_you_accept')); }} />
      {Platform.OS === 'web' ? (
        <IconButton icon={sound ? 'volume-high-outline' : 'volume-mute-outline'} variant={sound ? 'secondary' : 'tonal'}
          accessibilityLabel={sound ? t('ops.OnlineScreen.mute_new_order_sound') : t('ops.OnlineScreen.turn_on_new_order_sound')} onPress={() => { setSound(!sound); if (!sound) playAlert('online'); }} />
      ) : null}
    </>
  );

  return (
    <Screen
      title={t('common.online_orders')}
      subtitle={data ? t('ops.OnlineScreen.incomingtotal_waiting_v_length_in_progress', { incomingTotal: data.incomingTotal, v: waitingLong ? t('ops.OnlineScreen.waitinglong_over_warn_min', { waitingLong, warn: ages.online.warn }) : '', length: progressAll.length }) : undefined}
      onRefresh={reload}
      maxWidth={isDesktop ? 2000 : 1280}
      actions={
        <>
          {!isPhone ? liveToggles : null}
          {can(role, 'order') ? (
            <ActionMenu items={newMenu} align="end" title={t('ops.OnlineScreen.new_aggregator_order')}
              trigger={(open) => <Button title={isPhone ? t('common.new') : t('ops.OnlineScreen.new_aggregator_order')} accessibilityLabel={t('ops.OnlineScreen.new_aggregator_order')} icon="add" onPress={open} />} />
          ) : null}
        </>
      }
      toolbar={isPhone || (data && filters.length > 2) ? (
        <View style={{ gap: 8 }}>
          {isPhone ? <View style={styles.toggles}>{liveToggles}</View> : null}
          {data && filters.length > 2 ? <FilterBar filters={filters} value={channel} onChange={setChannel} /> : null}
        </View>
      ) : undefined}
    >
      {loading && !data ? (
        <Grid minItemWidth={340} gap={12}>{[0, 1, 2].map((i) => <Skeleton key={i} height={260} radius={14} />)}</Grid>
      ) : null}
      {error && !data ? <ErrorState message={error} onRetry={reload} /> : null}

      {data ? (
        <>
          <GroupTitle title={t('ops.OnlineScreen.new_length', { length: incoming.length })} right={<LiveStatus updatedAt={poll.updatedAt} error={error} paused={!poll.live} intervalLabel="5 s" />} />
          {incoming.length ? (
            <Grid minItemWidth={isPhone ? 300 : 360} gap={12}>
              {incoming.map((o) => (
                <OnlineOrderCard key={o.id} order={o} mode="new" now={now} ageLimits={ages.online} isNew={!!glow[o.id] && now - glow[o.id]! < NEW_GLOW_MS} onChanged={changed} />
              ))}
            </Grid>
          ) : (
            <Card style={styles.caughtUp}>
              <View style={[styles.caughtIcon, { backgroundColor: colors.successSoft }]}>
                <Ionicons name="checkmark-done" size={26} color={colors.success} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text variant="h3">{t('common.all_caught_up')}</Text>
                <Text tone="muted">{t('ops.OnlineScreen.new_orders_from_qr_tables_your_store_and')}</Text>
              </View>
            </Card>
          )}

          <GroupTitle title={t('ops.OnlineScreen.in_progress_length', { length: progress.length })} />
          {progress.length ? (
            <Grid minItemWidth={isPhone ? 300 : 360} gap={12}>
              {progress.map((o) => <OnlineOrderCard key={o.id} order={o} mode="progress" now={now} ageLimits={ages.online} isNew={false} onChanged={changed} />)}
            </Grid>
          ) : (
            <Text tone="muted" style={{ paddingHorizontal: 4 }}>{t('ops.OnlineScreen.accepted_online_orders_stay_here_until')}</Text>
          )}

          {showInfo ? (
            <View style={{ marginTop: 8 }}>
              <Notice tone="neutral" icon="information-circle-outline" title={t('ops.OnlineScreen.about_swiggy_zomato')}
                message={t('ops.OnlineScreen.swiggy_and_zomato_send_orders')}
                action={can(role, 'manage') ? { label: t('ops.OnlineScreen.open_sales_channels'), onPress: () => router.push('/settings') } : undefined}
                onClose={() => setShowInfo(false)} />
            </View>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}

function OnlineOrderCard({ order, mode, now, ageLimits, isNew, onChanged }: { order: OpsOrder; mode: 'new' | 'progress'; now: number; ageLimits: AgeThresholds; isNew: boolean; onChanged: () => void }) {
  const { colors, radius } = useTheme();
  const role = useAuth((s) => s.session?.role ?? null);
  const settings = useData((s) => s.settings);
  const sym = settings?.currency_symbol ?? '₹';
  const [busy, setBusy] = useState<null | 'accept' | 'reject' | 'print' | 'kot'>(null);
  const [expanded, setExpanded] = useState(false);
  const mins = minutesBetween(order.created_at, now);
  const tone = mode === 'new' ? ageTone(mins, ageLimits) : 'ok';
  const age = ageColors(colors, tone);
  const prepaid = order.payment_status === 'paid';
  const shown = expanded ? order.items : order.items.slice(0, 6);
  const label = order.external_order_id ?? `#${order.code}`;
  const canAct = can(role, 'bill');
  const choice = payChoice(order.notes);
  const notes = choice ? choice.rest : order.notes;
  const claim = paymentClaimOf(order);
  const isQr = order.channel === 'QR';

  const printKot = async (o: OpsOrder) => {
    try {
      await printKitchenTicket(kotFromOrder({ ...o, table_label: o.table_label ?? order.table_label }));
    } catch (e) {
      toast.error(printErrorMessage(e));
    }
  };

  const accept = async () => {
    setBusy('accept');
    try {
      const updated = await ordersApi.accept(order.id);
      toast.success(t('ops.OnlineScreen.order_label_accepted_sent_to_kitchen', { label }));
      onChanged();
      if (usePrefs.getState().autoPrintKot) await printKot(updated);
    } catch (e) {
      toast.error(errorMessage(e));
      onChanged();
    } finally {
      setBusy(null);
    }
  };

  const reject = async () => {
    const reason = await prompt({
      title: t('ops.OnlineScreen.reject_order_label', { label }), message: t('ops.OnlineScreen.the_customer_will_see_this_reason'),
      label: t('common.reason'), placeholder: t('ops.OnlineScreen.e_g_item_out_of_stock_kitchen_closing'), confirmLabel: t('ops.OnlineScreen.reject_order'), danger: true, minLength: 3,
    });
    if (!reason) return;
    setBusy('reject');
    try {
      await ordersApi.reject(order.id, reason);
      toast.info(t('ops.OnlineScreen.order_label_rejected', { label }));
      onChanged();
    } catch (e) {
      toast.error(errorMessage(e));
      onChanged();
    } finally {
      setBusy(null);
    }
  };

  const print = async () => {
    setBusy('print');
    try {
      await printBill(order, settings);
    } catch (e) {
      toast.error(printErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const more: ActionMenuItem[] = [
    { key: 'kot', label: t('ops.OnlineScreen.print_kot'), icon: 'flame-outline', onPress: () => { setBusy('kot'); void printKot(order).finally(() => setBusy(null)); } },
    { key: 'bill', label: t('common.print_bill'), icon: 'print-outline', onPress: () => void print() },
    { key: 'open', label: t('common.open_in_billing'), icon: 'receipt-outline', hidden: !can(role, 'order'), onPress: () => router.push({ pathname: '/pos', params: { order: order.id } }) },
  ];

  const border = isNew ? colors.kitchen : mode === 'new' && tone !== 'ok' ? age.solid : mode === 'new' ? colors.borderStrong : colors.border;
  return (
    <Card padded={false} style={[styles.card, { borderColor: border, borderWidth: isNew || (mode === 'new' && tone !== 'ok') ? 2 : 1 },
      isNew && { backgroundColor: colors.kitchenSoft }]}>
      {/* Header */}
      <View style={styles.cardHead}>
        <ChannelTile code={order.channel} size={46} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="h3" numberOfLines={1}>{channelLabel(order.channel)} <Text tone="muted" variant="body">{label}</Text></Text>
          <Text variant="small" tone="muted" numberOfLines={1}>
            {order.table_label ? t('ops.OnlineScreen.table_table_label_v', { table_label: order.table_label, v: order.bill_label ? ` · ${order.bill_label}` : '' }) : ORDER_TYPE_UI[order.type] ?? order.type}
            {order.token_no ? t('ops.OnlineScreen.token_token_no', { token_no: order.token_no }) : ''} · {formatTime(order.created_at)}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          {mode === 'new' ? <AgeChip minutes={mins} tone={tone} size="md" /> : <StatusPill status={order.status} />}
          {isNew ? <StatusPill status="placed" label="NEW" /> : null}
        </View>
      </View>

      <View style={styles.cardBody}>
        {order.customer_name || order.customer_phone || order.guests ? (
          <View style={styles.infoRow}>
            <Ionicons name={isQr ? 'people-outline' : 'person-outline'} size={16} color={colors.textSubtle} />
            <Text variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>{order.customer_name ?? (isQr ? t('ops.OnlineScreen.guest') : t('common.customer'))}</Text>
            {order.guests ? <Text tone="muted" numberOfLines={1}>{t('ops.OnlineScreen.guests_guest', { guests: order.guests })}{order.guests === 1 ? '' : 's'}</Text> : null}
            {order.customer_phone ? <Text tone="muted" numberOfLines={1}>{order.customer_phone}</Text> : null}
          </View>
        ) : null}
        {order.delivery_address ? (
          <View style={styles.infoRow}>
            <Ionicons name="location-outline" size={16} color={colors.textSubtle} style={{ alignSelf: 'flex-start', marginTop: 2 }} />
            <Text variant="small" tone="muted" numberOfLines={3} style={{ flex: 1 }}>{order.delivery_address}</Text>
          </View>
        ) : null}

        <View style={[styles.items, { backgroundColor: colors.surfaceAlt, borderRadius: radius.md, borderColor: colors.divider }]}>
          {shown.map((i) => (
            <View key={i.id} style={{ flexDirection: 'row', gap: 10 }}>
              <Text variant="bodyStrong" style={{ minWidth: 28, fontVariant: ['tabular-nums'] }}>{i.quantity}×</Text>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={2}>{i.name}{i.variant_name ? <Text tone="muted"> · {i.variant_name}</Text> : null}</Text>
                {i.notes ? <Text variant="small" tone="warning" numberOfLines={2}>“{i.notes}”</Text> : null}
              </View>
            </View>
          ))}
          {order.items.length > 6 ? (
            <Button title={expanded ? t('ops.OnlineScreen.show_less') : t('ops.OnlineScreen.show_v_more_item_v2', { v: order.items.length - 6, v2: order.items.length - 6 === 1 ? '' : 's' })}
              variant="ghost" size="sm" onPress={() => setExpanded((v) => !v)} style={{ alignSelf: 'flex-start' }} />
          ) : null}
        </View>
        {notes ? <Notice tone="warning" icon="chatbox-ellipses-outline" message={notes} /> : null}
        <PaymentClaimBanner order={order} currency={sym} onChanged={() => onChanged()} compact />
      </View>

      <Divider />
      <View style={styles.cardFoot}>
        <View style={{ flexGrow: 1, flexBasis: 130, minWidth: 0, gap: 4 }}>
          <Text variant="h2" numberOfLines={1} style={{ fontVariant: ['tabular-nums'] }}>{money(order.total_amount, sym)}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {prepaid ? <StatusPill status="paid" label={t('ops.OnlineScreen.prepaid')} />
              : <StatusPill status={order.paid_amount > 0 ? 'partial' : 'unpaid'} label={order.paid_amount > 0 ? t('ops.OnlineScreen.due_money', { money: money(order.balance_due, sym) }) : undefined} />}
            {!prepaid && choice ? <StatusPill status="choice" label={choice.label} showIcon={false} /> : null}
            {claim ? <StatusPill status="claim" label={t('common.upi_to_confirm')} /> : null}
          </View>
        </View>
        {mode === 'new' ? (
          canAct ? (
            <View style={styles.actions}>
              <Button title={t('ops.OnlineScreen.reject')} variant="dangerOutline" onPress={reject} loading={busy === 'reject'} disabled={!!busy} />
              <Button title={t('ops.OnlineScreen.accept')} icon="checkmark" variant="success" size="lg" onPress={accept} loading={busy === 'accept'} disabled={!!busy}
                style={{ minWidth: 140 }} accessibilityLabel={t('ops.OnlineScreen.accept_order_label_v', { label, v: usePrefs.getState().autoPrintKot ? t('ops.OnlineScreen.and_print_kot') : '' })} />
            </View>
          ) : (
            <Text variant="small" tone="muted" style={{ maxWidth: 180 }} numberOfLines={3}>{t('ops.OnlineScreen.a_cashier_or_manager_needs_to_accept_this')}</Text>
          )
        ) : (
          <View style={styles.actions}>
            <ActionMenu items={more} align="end" title={t('ops.OnlineScreen.order_label', { label })}
              trigger={(open) => <Button icon="ellipsis-horizontal" variant="outline" accessibilityLabel={t('ops.OnlineScreen.more_for_order_label', { label })} onPress={open} loading={busy === 'print' || busy === 'kot'} />} />
            {can(role, 'order') ? (
              <Button title={canAct && order.balance_due > 0 ? t('ops.OnlineScreen.settle') : t('common.open')} iconRight="arrow-forward" variant={canAct && order.balance_due > 0 ? 'success' : 'tonal'}
                onPress={() => router.push({ pathname: '/pos', params: { order: order.id } })} />
            ) : null}
          </View>
        )}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  caughtUp: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 20 },
  caughtIcon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  card: { overflow: 'hidden', flex: 1 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, paddingBottom: 10 },
  cardBody: { paddingHorizontal: 16, paddingBottom: 14, gap: 10, flex: 1 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 },
  items: { padding: 12, gap: 8, borderWidth: 1 },
  cardFoot: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, flexWrap: 'wrap' },
  actions: { flexDirection: 'row', gap: 8, alignItems: 'center', flexGrow: 1, justifyContent: 'flex-end' },
  toggles: { flexDirection: 'row', gap: 8, alignItems: 'center' },
});
