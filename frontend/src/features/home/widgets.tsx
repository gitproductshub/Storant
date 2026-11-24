/**
 * Home widget cards. Each card shows what the server sent; money appears only when the server included it.
 * A card opens its screen with one tap (the whole card is the button, so nothing inside it is pressable). The one
 * exception is the hourly chart, whose bars can be tapped: that card has its own "Open reports" button instead.
 */
import React from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { DashboardWidget, WidgetDataMap, WidgetKey } from '@/api/dashboard';
import { Button, Card, Text } from '@/components/ui';
import { money } from '@/lib/format';
import { PAYMENT_UI } from '@/lib/uiLabels';
import { formatAge, minutesBetween } from '@/features/ops/floorLogic';
import { HourlyChart } from '@/features/reports/charts';
import { hourLabel } from '@/features/reports/range';
import { useTheme } from '@/theme/ThemeProvider';
import { t } from '@/i18n';
import { WIDGET_META } from './widgetMeta';

export { WIDE_WIDGETS, WIDGET_META } from './widgetMeta';

/** Widgets with their own tappable parts: the card itself is not a button. */
const INTERACTIVE: ReadonlySet<WidgetKey> = new Set<WidgetKey>(['hourly_sales']);

/** "Table 5 · Asha" or the bill code when there is no table. */
function place(tableLabel: string | null | undefined, billLabel: string | null | undefined, code?: string | null): string {
  const where = tableLabel ? t('home.widgets.table_v', { v: tableLabel }) : (code ?? '');
  return billLabel ? `${where} · ${billLabel}` : where;
}

function Big({ value, label, tone }: { value: string; label?: string; tone?: 'default' | 'warning' | 'success' | 'danger' }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
      <Text variant="moneyLarge" tone={tone ?? 'default'}>{value}</Text>
      {label ? <Text variant="small" tone="muted">{label}</Text> : null}
    </View>
  );
}

function Line({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'muted' | 'warning' | 'danger' | 'subtle' | 'default' }) {
  return <Text variant="small" tone={tone} numberOfLines={1}>{children}</Text>;
}

/** A thin share-of-total bar (not pressable). */
function ShareBar({ share }: { share: number }) {
  const { colors } = useTheme();
  const pct = Math.max(0, Math.min(100, Math.round(share * 100)));
  return (
    <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.surfaceSunken, overflow: 'hidden' }}>
      <View style={{ width: `${pct}%`, height: 6, backgroundColor: colors.primary }} />
    </View>
  );
}

export function WidgetCard({ widget, symbol, now, onOpen, large = false }: {
  widget: DashboardWidget; symbol: string; now: number; onOpen: (route: string) => (() => void) | undefined; large?: boolean;
}) {
  const { colors } = useTheme();
  const meta = WIDGET_META[widget.key];
  if (!meta) return null; // a widget this app version doesn't know yet
  const go = onOpen(meta.route);
  const interactive = INTERACTIVE.has(widget.key);
  return (
    <Card onPress={interactive ? undefined : go} style={{ gap: 8, flexGrow: 1 }}>
      <View accessibilityRole="header" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Ionicons name={meta.icon} size={large ? 22 : 18} color={colors.primary} />
        <Text variant={large ? 'bodyStrong' : 'smallStrong'} tone="muted" style={{ flex: 1 }} numberOfLines={1}>{meta.title()}</Text>
        {go && !interactive ? <Ionicons name="chevron-forward" size={16} color={colors.textSubtle} /> : null}
      </View>
      {widget.error || !widget.data ? (
        <Text variant="small" tone="danger">{t('home.widgets.could_not_load')}</Text>
      ) : (
        <WidgetBody widget={widget} symbol={symbol} now={now} large={large} />
      )}
      {interactive && go ? (
        <Button title={t('home.widgets.open_reports')} icon="stats-chart-outline" variant="ghost" size="sm" onPress={go} style={{ alignSelf: 'flex-start' }} />
      ) : null}
    </Card>
  );
}

function WidgetBody({ widget, symbol, now, large }: { widget: DashboardWidget; symbol: string; now: number; large: boolean }) {
  const m = (v: number | undefined) => money(v ?? 0, symbol);
  const age = (iso: string | null | undefined) => formatAge(minutesBetween(iso, now));
  switch (widget.key) {
    case 'today_sales': {
      const d = widget.data as WidgetDataMap['today_sales'];
      return (
        <>
          <Big value={m(d.gross_sales)} />
          <Line>{t('home.widgets.bills_average', { count: d.orders, average: m(d.average_order_value) })}</Line>
        </>
      );
    }
    case 'open_bills': {
      const d = widget.data as WidgetDataMap['open_bills'];
      return (
        <>
          <Big value={String(d.count)} label={t('home.widgets.running')} />
          {d.value !== undefined && d.count ? <Line>{t('home.widgets.worth_v', { v: m(d.value) })}</Line> : null}
          {d.tables_total ? <Line>{t('home.widgets.tables_busy', { busy: d.tables_occupied ?? 0, total: d.tables_total })}</Line> : null}
          {d.online_waiting ? <Line tone="warning">{t('home.widgets.online_waiting', { count: d.online_waiting })}</Line> : null}
          {!d.count ? <Line>{t('home.widgets.all_clear')}</Line> : null}
        </>
      );
    }
    case 'payment_claims': {
      const d = widget.data as WidgetDataMap['payment_claims'];
      return (
        <>
          <Big value={String(d.count)} label={t('home.widgets.to_confirm')} tone={d.count ? 'warning' : 'default'} />
          {d.bills.slice(0, 3).map((b) => (
            <Line key={b.order_id} tone="default">{[place(b.table_label, b.bill_label, b.code), b.amount !== undefined ? m(b.amount) : null].filter(Boolean).join(' · ')}</Line>
          ))}
          {!d.count ? <Line>{t('home.widgets.all_clear')}</Line> : null}
        </>
      );
    }
    case 'ready_to_pay': {
      const d = widget.data as WidgetDataMap['ready_to_pay'];
      return (
        <>
          <Big value={String(d.count)} label={t('home.widgets.ready_now')} tone={d.count ? 'success' : 'default'} />
          {d.value !== undefined && d.count ? <Line>{t('home.widgets.worth_v', { v: m(d.value) })}</Line> : null}
          {d.bills.slice(0, 3).map((b) => (
            <Line key={b.order_id} tone="default">{[place(b.table_label, b.bill_label, b.code), b.total !== undefined ? m(b.total) : null, age(b.since)].filter(Boolean).join(' · ')}</Line>
          ))}
          {!d.count ? <Line>{t('home.widgets.nothing_to_collect')}</Line> : null}
        </>
      );
    }
    case 'ready_to_serve': {
      const d = widget.data as WidgetDataMap['ready_to_serve'];
      return (
        <>
          <Big value={String(d.count)} label={t('home.widgets.waiting')} tone={d.count ? 'warning' : 'default'} />
          {d.mine ? <Line tone="warning">{t('home.widgets.for_you', { count: d.mine })}</Line> : null}
          {d.items.slice(0, 3).map((i) => (
            <Line key={`${i.order_id}-${i.kot_no}`} tone={i.mine ? 'default' : 'muted'}>
              {[place(i.table_label, i.bill_label), t('home.widgets.items_count', { count: i.ready_count }), age(i.ready_since)].join(' · ')}
            </Line>
          ))}
          {!d.count ? <Line>{t('home.widgets.all_clear')}</Line> : null}
        </>
      );
    }
    case 'my_tables': {
      const d = widget.data as WidgetDataMap['my_tables'];
      return (
        <>
          <Big value={String(d.running)} label={t('home.widgets.running')} />
          {d.tables.slice(0, 5).map((tb) => {
            const cooking = tb.kitchen.pending + tb.kitchen.preparing;
            const parts = [
              cooking ? t('home.widgets.cooking_count', { count: cooking }) : null,
              tb.kitchen.ready ? t('home.widgets.ready_count', { count: tb.kitchen.ready }) : null,
              tb.bills ? null : t('home.widgets.free'),
            ].filter(Boolean);
            return (
              <Line key={tb.table_id} tone={tb.kitchen.ready ? 'warning' : 'default'}>
                {[t('home.widgets.table_v', { v: tb.label }), ...parts].join(' · ')}
              </Line>
            );
          })}
          {!d.tables.length ? <Line>{t('home.widgets.no_tables_yet')}</Line> : null}
        </>
      );
    }
    case 'kitchen': {
      const d = widget.data as WidgetDataMap['kitchen'];
      return (
        <>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <Count value={d.pending} label={t('common.new')} large={large} />
            <Count value={d.preparing} label={t('common.preparing')} large={large} />
            <Count value={d.ready} label={t('common.ready')} large={large} />
          </View>
          {d.oldest_at ? <Line tone="warning">{t('home.widgets.oldest_v', { v: age(d.oldest_at) })}</Line> : <Line>{t('home.widgets.all_clear')}</Line>}
          {d.to_prepare.slice(0, large ? 8 : 5).map((i) => (
            <Text key={`${i.name}-${i.variant ?? ''}`} variant={large ? 'bodyStrong' : 'small'} numberOfLines={1}>
              {`${i.name}${i.variant ? ` (${i.variant})` : ''} × ${i.quantity}`}
            </Text>
          ))}
        </>
      );
    }
    case 'low_stock': {
      const d = widget.data as WidgetDataMap['low_stock'];
      return (
        <>
          <Big value={String(d.count)} label={t('home.widgets.items_low')} tone={d.count ? 'warning' : 'default'} />
          {d.out ? <Line tone="warning">{t('home.widgets.out_of_stock', { count: d.out })}</Line> : null}
          {!d.count ? <Line>{t('home.widgets.all_clear')}</Line> : null}
        </>
      );
    }
    case 'my_day': {
      const d = widget.data as WidgetDataMap['my_day'];
      return (
        <>
          <Big value={String(d.orders)} label={t('home.widgets.bills_today')} />
          <Line>{t('home.widgets.tables_items', { tables: d.tables_served, items: d.items })}</Line>
          {d.bills_settled ? <Line>{t('home.widgets.settled_count', { count: d.bills_settled })}</Line> : null}
          {d.sales !== undefined ? <Line>{t('home.widgets.sales_v', { v: m(d.sales) })}</Line> : null}
          {d.collected !== undefined ? <Line>{t('home.widgets.collected_v', { v: m(d.collected) })}</Line> : null}
        </>
      );
    }
    case 'my_collection': {
      const d = widget.data as WidgetDataMap['my_collection'];
      return (
        <>
          <Big value={m(d.total)} label={t('home.widgets.bills_count', { count: d.count })} />
          {d.by_method.map((r) => (
            <Line key={r.method} tone="default">{`${PAYMENT_UI[r.method] ?? r.method} · ${m(r.amount)} (${r.count})`}</Line>
          ))}
          {!d.count ? <Line>{t('home.widgets.nothing_collected')}</Line> : null}
        </>
      );
    }
    case 'payment_split': {
      const d = widget.data as WidgetDataMap['payment_split'];
      return (
        <>
          <Big value={m(d.total)} />
          {d.by_method.slice(0, 5).map((r) => (
            <View key={r.method} style={{ gap: 3 }}>
              <Line tone="default">{`${PAYMENT_UI[r.method] ?? r.method} · ${m(r.amount)} (${r.count})`}</Line>
              <ShareBar share={d.total ? r.amount / d.total : 0} />
            </View>
          ))}
          {!d.by_method.length ? <Line>{t('home.widgets.no_sales_yet')}</Line> : null}
        </>
      );
    }
    case 'hourly_sales': {
      const d = widget.data as WidgetDataMap['hourly_sales'];
      if (!d.hourly.some((v) => v > 0)) return <Line>{t('home.widgets.no_sales_yet')}</Line>;
      return (
        <>
          {d.peak_hour !== null ? <Line>{t('home.widgets.peak_v', { v: hourLabel(d.peak_hour) })}</Line> : null}
          <HourlyChart hourly={d.hourly} symbol={symbol} height={160} />
        </>
      );
    }
    case 'top_items': {
      const d = widget.data as WidgetDataMap['top_items'];
      const top = d.items[0]?.revenue || 0;
      return (
        <>
          {d.items.slice(0, 5).map((i) => (
            <View key={i.name} style={{ gap: 3 }}>
              <Line tone="default">{`${i.name} · ${i.quantity} · ${m(i.revenue)}`}</Line>
              <ShareBar share={top ? i.revenue / top : 0} />
            </View>
          ))}
          {!d.items.length ? <Line>{t('home.widgets.no_sales_yet')}</Line> : null}
        </>
      );
    }
    case 'voids_comps': {
      const d = widget.data as WidgetDataMap['voids_comps'];
      const rows: [string, number, number | undefined][] = [
        [t('home.widgets.cancelled_bills', { count: d.cancelled_bills }), d.cancelled_bills, d.cancelled_bills_value],
        [t('home.widgets.items_cancelled', { count: d.items_cancelled }), d.items_cancelled, d.items_cancelled_value],
        [t('home.widgets.items_removed', { count: d.items_removed }), d.items_removed, d.items_removed_value],
        [t('home.widgets.on_the_house', { count: d.on_the_house }), d.on_the_house, d.on_the_house_value],
        [t('home.widgets.manual_discounts', { count: d.discounted_bills }), d.discounted_bills, d.discount_value],
      ];
      const any = rows.some(([, n]) => n > 0);
      return (
        <>
          {rows.filter(([, n]) => n > 0).map(([label, , value]) => (
            <Line key={label} tone="default">{value !== undefined ? `${label} · ${m(value)}` : label}</Line>
          ))}
          {!any ? <Line>{t('home.widgets.all_clear')}</Line> : null}
        </>
      );
    }
    case 'floor_live': {
      const d = widget.data as WidgetDataMap['floor_live'];
      return (
        <>
          <Big value={`${d.occupied}/${d.total}`} label={t('home.widgets.tables_in_use')} />
          {d.warn ? <Line tone="warning">{t('home.widgets.over_min', { min: d.amber_min, count: d.warn })}</Line> : null}
          {d.late ? <Line tone="danger">{t('home.widgets.over_min', { min: d.red_min, count: d.late })}</Line> : null}
          {d.longest ? <Line>{t('home.widgets.longest_v', { v: `${place(d.longest.table_label, null)} · ${age(d.longest.since)}` })}</Line> : null}
          {!d.occupied ? <Line>{t('home.widgets.all_clear')}</Line> : null}
        </>
      );
    }
    case 'kitchen_delays': {
      const d = widget.data as WidgetDataMap['kitchen_delays'];
      const o = d.oldest;
      const label = o ? (o.table_label ? place(o.table_label, null) : o.token_no ? t('home.widgets.token_v', { v: o.token_no }) : t('home.widgets.kot_v', { v: o.kot_no ?? '' })) : '';
      return (
        <>
          <Big value={String(d.cooking)} label={t('home.widgets.cooking')} tone={d.late ? 'danger' : d.warn ? 'warning' : 'default'} />
          {d.warn ? <Line tone="warning">{t('home.widgets.over_min', { min: d.amber_min, count: d.warn })}</Line> : null}
          {d.late ? <Line tone="danger">{t('home.widgets.over_min', { min: d.red_min, count: d.late })}</Line> : null}
          {o ? <Line>{t('home.widgets.longest_v', { v: `${label} · ${age(o.since)}` })}</Line> : <Line>{t('home.widgets.all_clear')}</Line>}
        </>
      );
    }
    default:
      return null;
  }
}

function Count({ value, label, large }: { value: number; label: string; large: boolean }) {
  return (
    <View style={{ flex: 1, minWidth: 0 }}>
      <Text variant={large ? 'display' : 'moneyLarge'}>{String(value)}</Text>
      <Text variant={large ? 'body' : 'small'} tone="muted" numberOfLines={1}>{label}</Text>
    </View>
  );
}
