import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { Button, Chip, EmptyState, ErrorState, IconButton, Input, Screen, Segmented, Text, toast, useHotkeys } from '@/components/ui';
import { ItemSalesView } from './ItemSalesView';
import { useAuth, useRole, can } from '@/store/auth';
import { useData } from '@/store/data';
import type { SalesSummary } from '@/api/types';
import { money } from '@/lib/format';
import { CHANNEL_UI, ORDER_TYPE_UI, PAYMENT_UI } from '@/lib/uiLabels';
import { printHtml, PrinterError } from '@/lib/print/printers';
import { PRESETS, isSingleDay, presetRange, rangeDays, rangeLabel, rangeSlug, validateCustom, ymd, type ReportRange } from './range';
import { useReports, type ItemRow, type StaffRow, type WastageRow } from './useReports';
import { BarList, HourlyChart } from './charts';
import { Cell, DataTable, KpiGrid, Panel, PanelError, Skeleton, type Kpi } from './ui';
import { dayEndHtml, itemsCsv, summaryCsv } from './exportData';
import { saveTextFile } from './saveFile';
import { t as tr, currentLocale } from '@/i18n';

export default function ReportsScreen() {
  const role = useRole();
  if (!can(role, 'manage')) {
    return (
      <Screen title={tr('common.reports')}>
        <EmptyState icon="lock-closed-outline" title={tr('reports.ReportsScreen.reports_are_for_owners_and_managers')}
          message={tr('reports.ReportsScreen.sales_reports_show_the_whole_business_s')} />
      </Screen>
    );
  }
  return <ReportsBody />;
}

function ReportsBody() {
  const { colors } = useTheme();
  const { isPhone } = useLayout();
  const settings = useData((s) => s.settings);
  const session = useAuth((s) => s.session);
  const symbol = settings?.currency_symbol || '₹';
  const businessName = settings?.business_name || session?.businessName || 'Business';

  const [range, setRange] = useState<ReportRange>(() => presetRange('today'));
  const [customOpen, setCustomOpen] = useState(false);
  const [fromText, setFromText] = useState('');
  const [toText, setToText] = useState('');
  const [customErrors, setCustomErrors] = useState<{ from?: string; to?: string }>({});
  const [busy, setBusy] = useState<null | 'summary' | 'items' | 'print'>(null);
  const [contentWidth, setContentWidth] = useState(0);
  const [view, setView] = useState<'overview' | 'items'>('overview');

  const report = useReports(range);
  const summary = report.summary.data;
  const label = rangeLabel(range);
  const twoCol = contentWidth >= 760;

  const pickPreset = (id: (typeof PRESETS)[number]['id']) => {
    setCustomOpen(false);
    setCustomErrors({});
    setRange(presetRange(id));
  };
  // Desktop: 1-5 pick a date preset, I / O switch between the item table and the overview
  useHotkeys(Object.fromEntries([
    ...PRESETS.map((p, i) => [String(i + 1), () => pickPreset(p.id)]),
    ['i', () => setView('items')], ['o', () => setView('overview')],
  ]), []);

  const openCustom = () => {
    setFromText(ymd(range.start));
    setToText(ymd(new Date(range.end.getTime() - 86_400_000)));
    setCustomErrors({});
    setCustomOpen(true);
  };

  const applyCustom = () => {
    const r = validateCustom(fromText, toText);
    if (r.errors) {
      setCustomErrors(r.errors);
      return;
    }
    setCustomErrors({});
    setCustomOpen(false);
    setRange(r.range);
  };

  const exportSummary = async () => {
    if (!summary) return;
    setBusy('summary');
    try {
      await saveTextFile(`storant-summary-${rangeSlug(range)}.csv`,
        summaryCsv(summary, label, { staff: report.staff.data, wastage: report.wastage.data }));
      toast.success(tr('reports.ReportsScreen.summary_exported'));
    } catch (e: any) {
      toast.error(e?.message || tr('reports.ReportsScreen.could_not_export_the_summary'));
    } finally {
      setBusy(null);
    }
  };

  const exportItems = async () => {
    if (!report.items.data?.length) return;
    setBusy('items');
    try {
      await saveTextFile(`storant-items-${rangeSlug(range)}.csv`, itemsCsv(report.items.data, label));
      toast.success(tr('reports.ReportsScreen.item_wise_sales_exported'));
    } catch (e: any) {
      toast.error(e?.message || tr('reports.ReportsScreen.could_not_export_item_wise_sales'));
    } finally {
      setBusy(null);
    }
  };

  const printDayEnd = async () => {
    if (!summary) return;
    setBusy('print');
    try {
      await printHtml(dayEndHtml(summary, {
        businessName, periodLabel: label, singleDay: isSingleDay(range), symbol, printedBy: session?.fullName || session?.email,
      }));
    } catch (e) {
      if (!(e instanceof PrinterError && e.code === 'CANCELLED')) toast.error(e instanceof Error && e.message ? e.message : tr('reports.ReportsScreen.could_not_print_the_summary'));
    } finally {
      setBusy(null);
    }
  };

  const printLabel = isSingleDay(range) ? 'Day-end summary' : 'Print summary';
  const actions = isPhone ? (
    <>
      <IconButton icon="download-outline" accessibilityLabel={tr('reports.ReportsScreen.export_summary_as_csv')} variant="secondary" onPress={exportSummary} disabled={!summary || busy !== null} />
      <IconButton icon="print-outline" accessibilityLabel={printLabel} variant="secondary" onPress={printDayEnd} disabled={!summary || busy !== null} />
      <IconButton icon="refresh" accessibilityLabel={tr('reports.ReportsScreen.refresh_reports')} variant="secondary" onPress={() => void report.reload()} disabled={report.refreshing || report.loading} />
    </>
  ) : (
    <>
      <Button title={tr('reports.ReportsScreen.export_csv')} icon="download-outline" variant="secondary" onPress={exportSummary} loading={busy === 'summary'} disabled={!summary || (busy !== null && busy !== 'summary')} />
      <Button title={printLabel} icon="print-outline" variant="secondary" onPress={printDayEnd} loading={busy === 'print'} disabled={!summary || (busy !== null && busy !== 'print')} />
      <IconButton icon="refresh" accessibilityLabel={tr('reports.ReportsScreen.refresh_reports')} variant="secondary" onPress={() => void report.reload()} disabled={report.refreshing || report.loading} />
    </>
  );

  const viewSwitch = (
    <View style={{ width: isPhone ? '100%' : 260 }}>
      <Segmented<'overview' | 'items'> value={view} onChange={setView} options={[
        { value: 'overview', label: tr('common.overview'), icon: 'stats-chart-outline' },
        { value: 'items', label: report.items.data ? tr('reports.ReportsScreen.items_length', { length: report.items.data.length }) : tr('common.items'), icon: 'list-outline' },
      ]} />
    </View>
  );
  const toolbar = (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: isPhone ? 'column' : 'row', gap: 10, alignItems: isPhone ? 'stretch' : 'center' }}>
      {viewSwitch}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 1, flexShrink: 1 }} contentContainerStyle={{ gap: 8, paddingRight: 8, alignItems: 'center' }}>
        {PRESETS.map((p) => (
          <Chip key={p.id} label={p.label} selected={range.preset === p.id && !customOpen} onPress={() => pickPreset(p.id)} />
        ))}
        <Chip label={range.preset === 'custom' && !customOpen ? label : tr('common.custom')} icon="calendar-outline" selected={range.preset === 'custom' || customOpen}
          onPress={() => (customOpen ? setCustomOpen(false) : openCustom())} />
      </ScrollView>
      </View>
      {customOpen ? (
        <View style={[styles.custom, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Input label={tr('common.from')} value={fromText} onChangeText={(v) => { setFromText(v); setCustomErrors((e) => ({ ...e, from: undefined })); }}
            placeholder={tr('common.yyyy_mm_dd')} error={customErrors.from} containerStyle={styles.dateInput} maxLength={10} autoCorrect={false}
            keyboardType="numbers-and-punctuation" icon="calendar-outline" returnKeyType="next" />
          <Input label={tr('common.to')} value={toText} onChangeText={(v) => { setToText(v); setCustomErrors((e) => ({ ...e, to: undefined })); }}
            placeholder={tr('common.yyyy_mm_dd')} error={customErrors.to} containerStyle={styles.dateInput} maxLength={10} autoCorrect={false}
            keyboardType="numbers-and-punctuation" icon="calendar-outline" returnKeyType="go" onSubmitEditing={applyCustom} />
          <View style={styles.customActions}>
            <Button title={tr('common.cancel')} variant="ghost" onPress={() => setCustomOpen(false)} />
            <Button title={tr('common.apply')} icon="checkmark" onPress={applyCustom} />
          </View>
        </View>
      ) : null}
    </View>
  );

  let body: React.ReactNode;
  if (report.loading && report.key === null) {
    body = <ReportsSkeleton twoCol={twoCol} />;
  } else if (!summary && report.summary.error) {
    body = <ErrorState message={report.summary.error} onRetry={() => void report.retry()} />;
  } else if (summary) {
    body = (
      <View style={{ gap: 16, opacity: report.loading ? 0.55 : 1 }}>
        <KpiGrid items={kpis(summary, symbol)} />
        {summary.orders === 0 ? (
          <Panel title={tr('reports.ReportsScreen.sales')} icon="bar-chart-outline">
            <EmptyState icon="receipt-outline" title={tr('reports.ReportsScreen.no_sales_v', { v: isSingleDay(range) && range.preset === 'today' ? tr('reports.ReportsScreen.yet_today') : tr('reports.ReportsScreen.in_this_period') })}
              message={summary.open_orders && range.end.getTime() > Date.now()
                ? tr('reports.ReportsScreen.open_orders_order_v_still_open_sales', { open_orders: summary.open_orders, v: summary.open_orders > 1 ? tr('common.s_are') : tr('common.is') })
                : tr('reports.ReportsScreen.completed_bills_will_show_up_here_with')} />
          </Panel>
        ) : (
          <SalesPanels summary={summary} symbol={symbol} twoCol={twoCol} narrow={contentWidth > 0 && contentWidth < 560} range={range} />
        )}
        {summary.orders > 0 ? (
          <ItemsPanel rows={report.items.data} error={report.items.error} symbol={symbol} onRetry={() => void report.retry()}
            onExport={exportItems} exporting={busy === 'items'} disabled={busy !== null && busy !== 'items'} onSeeAll={() => setView('items')} />
        ) : null}
        <Row twoCol={twoCol}>
          {summary.orders > 0 ? <StaffPanel rows={report.staff.data} error={report.staff.error} symbol={symbol} onRetry={() => void report.retry()} /> : null}
          <WastagePanel rows={report.wastage.data} error={report.wastage.error} symbol={symbol} onRetry={() => void report.retry()} />
        </Row>
      </View>
    );
  } else {
    body = <ReportsSkeleton twoCol={twoCol} />;
  }

  if (view === 'items') {
    return (
      <Screen title={tr('common.reports')} subtitle={tr('reports.ReportsScreen.label_item_wise_sales', { label })} actions={actions} toolbar={toolbar} scroll={false}
        contentStyle={{ flex: 1, paddingBottom: 16 }}>
        <ItemSalesView rows={report.items.data} loading={report.loading || (!report.items.data && !report.items.error)} error={report.items.error}
          onRetry={() => void report.retry()} symbol={symbol} onExport={exportItems} exporting={busy === 'items'}
          exportDisabled={busy !== null && busy !== 'items'} onRefresh={() => void report.reload()} refreshing={report.refreshing} />
      </Screen>
    );
  }

  return (
    <Screen title={tr('common.reports')} subtitle={label} actions={actions} toolbar={toolbar} refreshing={report.refreshing} onRefresh={() => void report.reload()}>
      <View onLayout={(e) => setContentWidth(e.nativeEvent.layout.width)} style={{ gap: 16 }}>
        {body}
      </View>
    </Screen>
  );
}

function kpis(s: SalesSummary, symbol: string): Kpi[] {
  const m = (v: number) => money(v, symbol, true);
  const discountPct = s.gross_sales + s.discounts > 0 ? (s.discounts / (s.gross_sales + s.discounts)) * 100 : 0;
  return [
    { key: 'gross', label: tr('reports.ReportsScreen.gross_sales'), value: m(s.gross_sales), hint: tr('reports.ReportsScreen.m_before_gst', { m: m(s.net_sales) }), icon: 'trending-up-outline', tone: 'primary' },
    { key: 'orders', label: tr('common.orders'), value: s.orders.toLocaleString(currentLocale()), hint: tr('reports.ReportsScreen.completed_bills'), icon: 'receipt-outline', tone: 'info' },
    { key: 'aov', label: tr('reports.ReportsScreen.avg_order'), value: m(s.average_order_value), hint: tr('reports.ReportsScreen.per_completed_bill'), icon: 'calculator-outline', tone: 'accent' },
    { key: 'gst', label: tr('reports.ReportsScreen.gst_collected'), value: m(s.tax), hint: tr('reports.ReportsScreen.cgst_sgst'), icon: 'document-text-outline', tone: 'neutral' },
    { key: 'disc', label: tr('reports.ReportsScreen.discounts'), value: m(s.discounts), hint: discountPct ? tr('reports.ReportsScreen.tofixed_of_sales', { toFixed: discountPct.toFixed(1) }) : tr('reports.ReportsScreen.none_given'), icon: 'pricetag-outline', tone: 'warning' },
    { key: 'net', label: tr('reports.ReportsScreen.net_payout'), value: m(s.gross_sales - s.commission), hint: s.commission ? tr('reports.ReportsScreen.after_m_commission', { m: m(s.commission) }) : tr('reports.ReportsScreen.no_commission'), icon: 'wallet-outline', tone: 'success' },
    { key: 'cancel', label: tr('common.cancelled'), value: s.cancelled_orders.toLocaleString(currentLocale()), hint: s.cancelled_orders ? tr('reports.ReportsScreen.m_cancelled', { m: m(s.cancelled_value) }) : 'none', icon: 'close-circle-outline', tone: 'danger' },
    { key: 'open', label: tr('reports.ReportsScreen.open_orders'), value: s.open_orders.toLocaleString(currentLocale()), hint: s.open_orders ? tr('reports.ReportsScreen.m_unbilled_now', { m: m(s.open_value) }) : tr('reports.ReportsScreen.none_right_now'), icon: 'hourglass-outline', tone: 'neutral' },
  ];
}

function Row({ twoCol, children }: { twoCol: boolean; children: React.ReactNode }) {
  const items = React.Children.toArray(children).filter(Boolean);
  if (!items.length) return null;
  if (!twoCol || items.length === 1) return <>{items.map((c, i) => <View key={i}>{c}</View>)}</>;
  return (
    <View style={{ flexDirection: 'row', gap: 16, alignItems: 'stretch' }}>
      {items.map((c, i) => <View key={i} style={{ flex: 1, minWidth: 0 }}>{c}</View>)}
    </View>
  );
}

function SalesPanels({ summary: s, symbol, twoCol, narrow, range }: { summary: SalesSummary; symbol: string; twoCol: boolean; narrow: boolean; range: ReportRange }) {
  const { colors } = useTheme();
  const days = rangeDays(range);
  const totalPayments = s.by_payment.reduce((n, p) => n + p.amount, 0);
  const channelTotals = s.by_channel.reduce((t, c) => ({ orders: t.orders + c.orders, amount: t.amount + c.amount, commission: t.commission + c.commission, net: t.net + c.net }),
    { orders: 0, amount: 0, commission: 0, net: 0 });
  const payments = [...s.by_payment].sort((a, b) => b.amount - a.amount);
  const types = [...s.by_type].sort((a, b) => b.amount - a.amount);
  const maxTop = Math.max(1, ...s.top_items.map((t) => t.revenue));

  return (
    <>
      <Panel title={tr('reports.ReportsScreen.sales_by_hour')} subtitle={days > 1 ? tr('reports.ReportsScreen.combined_across_days_days', { days }) : tr('reports.ReportsScreen.completed_bills_by_the_hour_they_were')} icon="time-outline">
        <HourlyChart hourly={s.hourly} symbol={symbol} />
      </Panel>

      <Row twoCol={twoCol}>
        <Panel title={tr('reports.ReportsScreen.payment_methods')} subtitle={tr('reports.ReportsScreen.money_received', { money: money(totalPayments, symbol, true) })} icon="card-outline" style={{ flex: 1 }}>
          <BarList symbol={symbol} emptyLabel={tr('reports.ReportsScreen.no_payments_recorded_x')}
            data={payments.map((p) => ({ key: p.method, label: PAYMENT_UI[p.method] ?? p.method, value: p.amount, detail: tr('reports.ReportsScreen.count_payment_v', { count: p.count, v: p.count === 1 ? '' : 's' }) }))} />
        </Panel>
        <Panel title={tr('reports.ReportsScreen.order_types')} icon="restaurant-outline" style={{ flex: 1 }}>
          <BarList symbol={symbol}
            data={types.map((t) => ({ key: t.type, label: ORDER_TYPE_UI[t.type] ?? t.type, value: t.amount, detail: tr('reports.ReportsScreen.orders_order_v', { orders: t.orders, v: t.orders === 1 ? '' : 's' }) }))} />
        </Panel>
      </Row>

      <Panel title={tr('reports.ReportsScreen.channels')} subtitle={tr('reports.ReportsScreen.aggregator_commission_is_deducted_from')} icon="git-branch-outline">
        {narrow ? (
          <View style={{ gap: 0 }}>
            {[...s.by_channel].sort((a, b) => b.amount - a.amount).map((c) => (
              <View key={c.channel} style={[styles.channelRow, { borderBottomColor: colors.divider }]}
                accessible accessibilityLabel={tr('reports.ReportsScreen.v_orders_orders_gross_money_commission', { v: CHANNEL_UI[c.channel] ?? c.channel, orders: c.orders, money: money(c.amount, symbol), money2: money(c.commission, symbol), money3: money(c.net, symbol) })}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text variant="smallStrong" numberOfLines={1}>{CHANNEL_UI[c.channel] ?? c.channel}</Text>
                  <Text variant="caption" tone="subtle" numberOfLines={1}>
                    {tr('reports.ReportsScreen.orders_order', { orders: c.orders })}{c.orders === 1 ? '' : 's'} {tr('reports.ReportsScreen.gross')} {money(c.amount, symbol, true)}{c.commission ? tr('reports.ReportsScreen.money_fee', { money: money(c.commission, symbol, true) }) : ''}
                  </Text>
                </View>
                <Text variant="smallStrong" style={{ fontVariant: ['tabular-nums'] }}>{money(c.net, symbol, true)}</Text>
              </View>
            ))}
            <View style={[styles.channelRow, { borderBottomWidth: 0 }]}>
              <Text variant="smallStrong" style={{ flex: 1 }}>{tr('reports.ReportsScreen.net_total_orders_orders', { orders: channelTotals.orders })}</Text>
              <Text variant="smallStrong" style={{ fontVariant: ['tabular-nums'] }}>{money(channelTotals.net, symbol, true)}</Text>
            </View>
          </View>
        ) : (
          <DataTable minWidth={520} rows={[...s.by_channel].sort((a, b) => b.amount - a.amount)} rowKey={(r) => r.channel}
            columns={[
              { key: 'ch', label: tr('common.channel'), flex: 1.6, render: (r) => <Cell strong>{CHANNEL_UI[r.channel] ?? r.channel}</Cell> },
              { key: 'o', label: tr('common.orders'), align: 'right', render: (r) => <Cell align="right">{r.orders}</Cell> },
              { key: 'g', label: tr('reports.ReportsScreen.gross_2'), align: 'right', flex: 1.2, render: (r) => <Cell align="right">{money(r.amount, symbol, true)}</Cell> },
              { key: 'c', label: tr('reports.ReportsScreen.commission'), align: 'right', flex: 1.2, render: (r) => <Cell align="right" muted={!r.commission}>{r.commission ? `−${money(r.commission, symbol, true)}` : '—'}</Cell> },
              { key: 'n', label: tr('reports.ReportsScreen.net'), align: 'right', flex: 1.2, render: (r) => <Cell align="right" strong>{money(r.net, symbol, true)}</Cell> },
            ]}
            footer={[
              <Cell key="t" strong>{tr('common.total')}</Cell>, <Cell key="o" align="right" strong>{channelTotals.orders}</Cell>,
              <Cell key="g" align="right" strong>{money(channelTotals.amount, symbol, true)}</Cell>,
              <Cell key="c" align="right" strong>{channelTotals.commission ? `−${money(channelTotals.commission, symbol, true)}` : '—'}</Cell>,
              <Cell key="n" align="right" strong>{money(channelTotals.net, symbol, true)}</Cell>,
            ]} />
        )}
      </Panel>

      <Row twoCol={twoCol}>
        <Panel title={tr('reports.ReportsScreen.top_items')} subtitle={tr('reports.ReportsScreen.by_revenue_before_gst')} icon="trophy-outline" style={{ flex: 1 }}>
          {s.top_items.length ? (
            <View style={{ gap: 12 }}>
              {s.top_items.map((t, i) => (
                <View key={t.name} style={styles.topRow} accessible accessibilityLabel={tr('reports.ReportsScreen.rank_v_name_quantity_sold_money', { v: i + 1, name: t.name, quantity: t.quantity, money: money(t.revenue, symbol) })}>
                  <View style={[styles.rank, { backgroundColor: i < 3 ? colors.primarySoft : colors.surfaceSunken }]}>
                    <Text variant="smallStrong" color={i < 3 ? colors.primary : colors.textMuted}>{i + 1}</Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <Text variant="smallStrong" numberOfLines={1} style={{ flex: 1 }}>{t.name}</Text>
                      <Text variant="smallStrong" style={{ fontVariant: ['tabular-nums'] }}>{money(t.revenue, symbol, true)}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <View style={[styles.miniTrack, { backgroundColor: colors.surfaceSunken }]}>
                        <View style={{ width: `${(t.revenue / maxTop) * 100}%`, height: '100%', borderRadius: 3, backgroundColor: colors.primary, opacity: 0.75 }} />
                      </View>
                      <Text variant="caption" tone="subtle" style={{ minWidth: 52, textAlign: 'right' }}>{t.quantity} {tr('reports.ReportsScreen.sold')}</Text>
                    </View>
                  </View>
                </View>
              ))}
            </View>
          ) : <Text tone="subtle" variant="small">{tr('reports.ReportsScreen.no_items_sold')}</Text>}
        </Panel>
        <Panel title={tr('reports.ReportsScreen.category_sales')} subtitle={tr('reports.ReportsScreen.revenue_before_gst')} icon="albums-outline" style={{ flex: 1 }}>
          <BarList symbol={symbol}
            data={s.by_category.map((c) => ({ key: c.category, label: c.category, value: c.revenue, detail: tr('reports.ReportsScreen.quantity_sold', { quantity: c.quantity }) }))} />
        </Panel>
      </Row>
    </>
  );
}

const ITEMS_PREVIEW = 12;

function ItemsPanel({ rows, error, symbol, onRetry, onExport, exporting, disabled, onSeeAll }: {
  rows: ItemRow[] | null; error: string | null; symbol: string; onRetry: () => void; onExport: () => void; exporting: boolean; disabled: boolean;
  onSeeAll: () => void;
}) {
  // The overview shows the top sellers; every item is in the virtualised "Items" view
  const filtered = useMemo(() => [...(rows ?? [])].sort((a, b) => b.revenue - a.revenue), [rows]);
  const visible = filtered.slice(0, ITEMS_PREVIEW);
  const totals = filtered.reduce((t, r) => ({ qty: t.qty + r.quantity, revenue: t.revenue + r.revenue, tax: t.tax + r.tax }), { qty: 0, revenue: 0, tax: 0 });

  return (
    <Panel title={tr('reports.ReportsScreen.item_wise_sales')} subtitle={rows ? tr('reports.ReportsScreen.top_min_of_length_item_v_sold', { min: Math.min(ITEMS_PREVIEW, rows.length), length: rows.length, v: rows.length === 1 ? '' : 's' }) : undefined} icon="list-outline"
      actions={<Button title={tr('reports.ReportsScreen.export_csv')} size="sm" variant="secondary" icon="download-outline" onPress={onExport} loading={exporting} disabled={disabled || !rows?.length} />}>
      {error && !rows ? <PanelError message={error} onRetry={onRetry} /> : !rows ? <Skeleton height={120} /> : rows.length === 0 ? (
        <Text tone="subtle" variant="small">{tr('reports.ReportsScreen.no_items_sold')}</Text>
      ) : (
        <View style={{ gap: 10 }}>
          <DataTable minWidth={460} rows={visible} rowKey={(r) => `${r.name}|${r.variant ?? ''}`}
            columns={[
              { key: 'name', label: tr('common.item'), flex: 2.4, render: (r) => (
                <Text variant="small" numberOfLines={2}>
                  <Text variant="smallStrong">{r.name}</Text>{r.variant ? <Text variant="small" tone="muted"> · {r.variant}</Text> : null}
                </Text>
              ) },
              { key: 'qty', label: tr('reports.ReportsScreen.qty'), align: 'right', flex: 0.7, render: (r) => <Cell align="right">{r.quantity}</Cell> },
              { key: 'rev', label: tr('reports.ReportsScreen.revenue'), align: 'right', flex: 1.2, render: (r) => <Cell align="right" strong>{money(r.revenue, symbol)}</Cell> },
              { key: 'tax', label: tr('reports.ReportsScreen.tax'), align: 'right', render: (r) => <Cell align="right" muted>{money(r.tax, symbol)}</Cell> },
            ]}
            footer={[
              <Cell key="t" strong>{filtered.length > ITEMS_PREVIEW ? tr('reports.ReportsScreen.all_length_items', { length: filtered.length }) : tr('common.total')}</Cell>, <Cell key="q" align="right" strong>{totals.qty}</Cell>,
              <Cell key="r" align="right" strong>{money(totals.revenue, symbol)}</Cell>, <Cell key="x" align="right" strong>{money(totals.tax, symbol)}</Cell>,
            ]} />
          {filtered.length > ITEMS_PREVIEW ? (
            <Button title={tr('reports.ReportsScreen.see_all_length_items', { length: filtered.length })} variant="tonal" iconRight="arrow-forward" onPress={onSeeAll} style={{ alignSelf: 'center' }} />
          ) : null}
        </View>
      )}
    </Panel>
  );
}

function StaffPanel({ rows, error, symbol, onRetry }: { rows: StaffRow[] | null; error: string | null; symbol: string; onRetry: () => void }) {
  const sorted = [...(rows ?? [])].sort((a, b) => b.amount - a.amount);
  return (
    <Panel title={tr('reports.ReportsScreen.staff_performance')} subtitle={tr('reports.ReportsScreen.completed_bills_by_the_person_who_created')} icon="people-outline" style={{ flex: 1 }}>
      {error && !rows ? <PanelError message={error} onRetry={onRetry} /> : !rows ? <Skeleton height={80} /> : sorted.length === 0 ? (
        <Text tone="subtle" variant="small">{tr('reports.ReportsScreen.no_bills_in_this_period')}</Text>
      ) : (
        <DataTable rows={sorted} rowKey={(r, i) => r.user_id ?? `sys${i}`}
          columns={[
            { key: 'n', label: tr('common.staff'), flex: 1.6, render: (r) => <Cell strong>{r.name}</Cell> },
            { key: 'o', label: tr('common.bills'), align: 'right', flex: 0.7, render: (r) => <Cell align="right">{r.orders}</Cell> },
            { key: 'a', label: tr('reports.ReportsScreen.sales'), align: 'right', flex: 1.1, render: (r) => <Cell align="right" strong>{money(r.amount, symbol, true)}</Cell> },
            { key: 'v', label: tr('reports.ReportsScreen.avg'), align: 'right', render: (r) => <Cell align="right" muted>{money(r.orders ? r.amount / r.orders : 0, symbol, true)}</Cell> },
          ]} />
      )}
    </Panel>
  );
}

function WastagePanel({ rows, error, symbol, onRetry }: { rows: WastageRow[] | null; error: string | null; symbol: string; onRetry: () => void }) {
  const sorted = [...(rows ?? [])].sort((a, b) => b.cost - a.cost);
  const total = sorted.reduce((n, r) => n + r.cost, 0);
  return (
    <Panel title={tr('reports.ReportsScreen.wastage')} subtitle={tr('reports.ReportsScreen.stock_written_off_as_wasted_at_cost_price')} icon="trash-bin-outline" style={{ flex: 1 }}>
      {error && !rows ? <PanelError message={error} onRetry={onRetry} /> : !rows ? <Skeleton height={80} /> : sorted.length === 0 ? (
        <Text tone="subtle" variant="small">{tr('reports.ReportsScreen.no_wastage_recorded_in_this_period')}</Text>
      ) : (
        <DataTable rows={sorted} rowKey={(r) => r.product}
          columns={[
            { key: 'p', label: tr('common.item'), flex: 1.8, render: (r) => <Cell strong>{r.product}</Cell> },
            { key: 'q', label: tr('reports.ReportsScreen.qty'), align: 'right', flex: 0.7, render: (r) => <Cell align="right">{r.quantity}</Cell> },
            { key: 'c', label: tr('reports.ReportsScreen.cost'), align: 'right', render: (r) => <Cell align="right">{money(r.cost, symbol)}</Cell> },
          ]}
          footer={[<Cell key="t" strong>{tr('common.total')}</Cell>, <Cell key="q" align="right"> </Cell>, <Cell key="c" align="right" strong>{money(total, symbol)}</Cell>]} />
      )}
    </Panel>
  );
}

function ReportsSkeleton({ twoCol }: { twoCol: boolean }) {
  const { colors, radius } = useTheme();
  const card = (h: number, key: string) => (
    <View key={key} style={{ flex: 1, minWidth: 0, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface, padding: 16, gap: 14 }}>
      <Skeleton width="40%" height={16} />
      <Skeleton height={h} />
    </View>
  );
  return (
    <View style={{ gap: 16 }} accessibilityLabel={tr('reports.ReportsScreen.loading_reports')}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        {Array.from({ length: twoCol ? 8 : 4 }).map((_, i) => (
          <View key={i} style={{ width: twoCol ? '23.5%' : '48%', borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface, padding: 16, gap: 10 }}>
            <Skeleton width="60%" height={12} />
            <Skeleton width="75%" height={26} />
            <Skeleton width="45%" height={10} />
          </View>
        ))}
      </View>
      {card(200, 'chart')}
      <View style={{ flexDirection: twoCol ? 'row' : 'column', gap: 16 }}>
        {card(120, 'a')}
        {card(120, 'b')}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  custom: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignItems: 'flex-start', padding: 14, borderRadius: 14, borderWidth: 1 },
  dateInput: { flexGrow: 1, flexBasis: 160 },
  customActions: { flexDirection: 'row', gap: 8, alignSelf: 'flex-end', paddingBottom: 1 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rank: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  miniTrack: { flex: 1, height: 6, borderRadius: 3, overflow: 'hidden' },
  channelRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1 },
});
