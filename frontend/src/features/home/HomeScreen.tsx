/**
 * Home: every business login lands here. The server picks the widgets from the person's permissions, the plan and the
 * business type (backend app/services/dashboard.py) and leaves money out for people who may not see it; this screen
 * only lays out what it gets, in the order it gets them. Kitchens get the new-order voice here too, so a kitchen that
 * stays on Home never misses an order. The owner sees one card for dashboard extras their plan lacks. Home has no
 * Sign out of its own: it stays in Settings → Account, the phone's More screen and the desktop sidebar.
 */
import React, { useMemo } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import type { Role } from '@/api/types';
import type { DashboardWidget, WidgetKey } from '@/api/dashboard';
import { floorApi } from '@/api/floor';
import { Button, Card, ErrorState, Screen, Skeleton, SwitchRow, Text } from '@/components/ui';
import { visibleNavItems } from '@/components/nav/navItems';
import { useDevicePref, useLivePoll, useNow } from '@/hooks/live';
import { formatTime } from '@/lib/format';
import { useAccessInfo } from '@/store/access';
import { useAuth } from '@/store/auth';
import { useData } from '@/store/data';
import { usePrefs } from '@/store/prefs';
import { useSubscription } from '@/store/subscription';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { useKitchenVoice, useNewTicketAlerts } from '@/features/ops/useKitchenAlerts';
import { homeAlerts, type HomeAlert } from './homeLogic';
import { useDashboard } from './useDashboard';
import { WIDE_WIDGETS, WIDGET_META, WidgetCard } from './widgets';
import { t } from '@/i18n';

type IconName = keyof typeof Ionicons.glyphMap;

const QUICK: { route: string; icon: IconName; label: (waiterLike: boolean) => string }[] = [
  { route: 'pos', icon: 'add-circle-outline', label: (w) => (w ? t('home.HomeScreen.new_order') : t('home.HomeScreen.new_bill')) },
  { route: 'tables', icon: 'grid-outline', label: () => t('common.tables') },
  { route: 'orders', icon: 'document-text-outline', label: () => t('common.orders') },
  { route: 'kitchen', icon: 'flame-outline', label: () => t('home.HomeScreen.kitchen_display') },
  { route: 'reports', icon: 'stats-chart-outline', label: () => t('common.reports') },
];

export default function HomeScreen() {
  const { isPhone } = useLayout();
  const { colors } = useTheme();
  const session = useAuth((s) => s.session);
  const access = useAccessInfo();
  const settings = useData((s) => s.settings);
  const subscription = useSubscription((s) => s.current);
  const symbol = settings?.currency_symbol || '₹';
  const { data, fromSnapshot, error, loading, refreshing, updatedAt, reload } = useDashboard();
  const now = useNow(30_000);

  const role = (session?.role ?? null) as Role | null;
  const routes = useMemo(() => new Set(visibleNavItems(role, settings?.business_type, access).map((i) => i.route)), [role, settings?.business_type, access]);
  const persona = data?.persona ?? (role === 'kitchen' ? 'kitchen' : null);
  const isOwner = role === 'owner';
  const name = session?.fullName?.split(' ')[0] || session?.fullName || '';

  const canOpen = (route: string) => routes.has(route) || route === 'settings' || (route === 'subscription' && isOwner);
  const open = (route: string) => (canOpen(route) ? () => router.push(`/${route}` as Href) : undefined);
  const quick = persona === 'kitchen' ? [] : QUICK.filter((q) => routes.has(q.route)).slice(0, 4);
  const alerts = homeAlerts(data, { owner: isOwner, subscription }).filter((a) => canOpen(a.route));
  const offline = !!error && !!data;

  return (
    <Screen title={t('home.HomeScreen.title')}
      subtitle={[name ? t('home.HomeScreen.greeting', { name }) : null, session?.businessName].filter(Boolean).join(' · ')}
      refreshing={refreshing} onRefresh={reload}>
      {offline || fromSnapshot ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Ionicons name="cloud-offline-outline" size={16} color={colors.warning} />
          <Text variant="small" tone="warning">{t('home.HomeScreen.offline_showing', { time: updatedAt ? formatTime(new Date(updatedAt).toISOString()) : '' })}</Text>
        </View>
      ) : null}

      {persona === 'kitchen' && routes.has('kitchen') ? <KitchenPanel /> : null}

      {alerts.length ? <AlertStrip alerts={alerts} onOpen={open} /> : null}

      {quick.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {quick.map((q, i) => (
            <Button key={q.route} title={q.label(persona === 'waiter')} icon={q.icon} variant={i === 0 ? 'primary' : 'secondary'}
              size={isPhone ? 'md' : 'lg'} style={{ flexGrow: 1, flexBasis: isPhone ? '45%' : 160 }} onPress={() => router.push(`/${q.route}` as Href)} />
          ))}
        </View>
      ) : null}

      {loading && !data ? <HomeSkeleton /> : null}
      {error && !data ? <ErrorState message={error} onRetry={reload} /> : null}

      {data && data.widgets.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
          {data.widgets.map((w: DashboardWidget) => {
            const large = persona === 'kitchen' && w.key === 'kitchen';
            const wide = !isPhone && (large || WIDE_WIDGETS.has(w.key));
            return (
              <View key={w.key} style={{ flexGrow: 1, flexBasis: isPhone || wide ? '100%' : 300, minWidth: 0 }}>
                <WidgetCard widget={w} symbol={symbol} now={now} onOpen={open} large={large} />
              </View>
            );
          })}
        </View>
      ) : null}

      {data && !data.widgets.length && persona !== 'kitchen' ? <Welcome name={name} routes={routes} /> : null}

      {isOwner && subscription ? <PlanCard /> : null}
      {isOwner && data?.locked?.length ? <LockedCard keys={data.locked} /> : null}
    </Screen>
  );
}

/** The few things that need someone now; each opens its screen. */
function AlertStrip({ alerts, onOpen }: { alerts: HomeAlert[]; onOpen: (route: string) => (() => void) | undefined }) {
  const { colors, radius } = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {alerts.map((a) => {
        const bg = a.tone === 'danger' ? colors.dangerSoft : colors.warningSoft;
        const fg = a.tone === 'danger' ? colors.dangerText : colors.warningText;
        return (
          <Pressable key={a.key} onPress={onOpen(a.route)} accessibilityRole="button" accessibilityLabel={a.text}
            style={({ hovered }: any) => [{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 12,
              borderRadius: radius.pill, backgroundColor: bg, opacity: hovered ? 0.85 : 1 }, Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}>
            <Ionicons name={a.icon} size={16} color={fg} />
            <Text variant="smallStrong" style={{ color: fg }}>{a.text}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Kitchen: open the display, new-order voice (with the browser's one tap), and "start here" for this device. */
function KitchenPanel() {
  const ticketsPoll = useLivePoll(() => floorApi.tickets('active'), [], 5_000);
  const [sound] = useDevicePref<boolean>('kitchen.sound', true);
  useNewTicketAlerts(ticketsPoll.data, { sound });
  const voice = useKitchenVoice();
  const startHere = usePrefs((s) => s.startOnKitchenDisplay);
  const setPrefs = usePrefs((s) => s.set);
  return (
    <Card style={{ gap: 12 }}>
      {voice.needsTap ? (
        <Button title={t('ops.KitchenScreen.tap_to_turn_on_voice')} icon="mic-outline" variant="primary" size="lg" full onPress={voice.turnOn} />
      ) : null}
      <Button title={t('home.HomeScreen.open_kitchen_display')} icon="flame-outline" variant="kitchen" size="lg" full
        onPress={() => router.push('/kitchen' as Href)} />
      {voice.canSpeak ? (
        <Button title={voice.enabled ? t('home.HomeScreen.voice_on') : t('home.HomeScreen.voice_off')} icon={voice.enabled ? 'mic-outline' : 'mic-off-outline'}
          variant={voice.enabled ? 'secondary' : 'tonal'} full onPress={voice.toggle}
          accessibilityLabel={voice.enabled ? t('ops.KitchenScreen.turn_off_voice') : t('ops.KitchenScreen.turn_on_voice')} />
      ) : null}
      <SwitchRow title={t('home.HomeScreen.start_on_kitchen_display')} subtitle={t('home.HomeScreen.start_on_kitchen_display_hint')}
        value={startHere} onValueChange={(v) => setPrefs({ startOnKitchenDisplay: v })} />
    </Card>
  );
}

/** A role with very few permissions: who they are and the screens they can open. */
function Welcome({ name, routes }: { name: string; routes: Set<string> }) {
  const role = useAuth((s) => s.session?.role ?? null);
  const access = useAccessInfo();
  const settings = useData((s) => s.settings);
  const items = visibleNavItems(role, settings?.business_type, access).filter((i) => i.route !== 'home' && routes.has(i.route));
  return (
    <Card style={{ gap: 12 }}>
      <Text variant="h3">{name ? t('home.HomeScreen.welcome_name', { name }) : t('home.HomeScreen.welcome')}</Text>
      <Text tone="muted">{t('home.HomeScreen.welcome_body')}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {items.map((i) => (
          <Button key={i.route} title={i.label} icon={i.icon} variant="secondary" onPress={() => router.push(i.href as Href)} />
        ))}
      </View>
    </Card>
  );
}

/** Owner: the Storant plan and how long it runs, with a way to renew. */
function PlanCard() {
  const sub = useSubscription((s) => s.current);
  const planName = useSubscription((s) => s.info?.plan_name);
  if (!sub) return null;
  return (
    <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <View style={{ flex: 1, minWidth: 180, gap: 2 }}>
        <Text variant="smallStrong" tone="muted">{t('home.HomeScreen.your_plan')}</Text>
        <Text variant="bodyStrong" numberOfLines={1}>{planName || sub.label || ''}</Text>
        <Text variant="small" tone={sub.state === 'grace' ? 'danger' : 'muted'}>
          {sub.days_left === null ? t('home.HomeScreen.plan_no_end') : t('home.HomeScreen.plan_days_left', { count: sub.days_left })}
        </Text>
      </View>
      <Button title={t('home.HomeScreen.renew')} icon="card-outline" variant="secondary" onPress={() => router.push('/subscription' as Href)} />
    </Card>
  );
}

/** Owner: one card for the dashboard extras the plan doesn't include (never one per widget). */
function LockedCard({ keys }: { keys: WidgetKey[] }) {
  const { colors } = useTheme();
  const names = keys.map((k) => WIDGET_META[k]?.title()).filter(Boolean);
  return (
    <Card style={{ gap: 8, borderStyle: 'dashed' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Ionicons name="lock-closed-outline" size={18} color={colors.textSubtle} />
        <Text variant="bodyStrong" style={{ flex: 1 }}>{t('home.HomeScreen.locked_title')}</Text>
      </View>
      <Text variant="small" tone="muted">{t('home.HomeScreen.locked_body', { list: names.join(', ') })}</Text>
      <Button title={t('home.HomeScreen.see_plans')} icon="sparkles-outline" variant="secondary" size="sm" style={{ alignSelf: 'flex-start' }}
        onPress={() => router.push('/subscription' as Href)} />
    </Card>
  );
}

function HomeSkeleton() {
  const { isPhone } = useLayout();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
      {[0, 1, 2].map((i) => (
        <Card key={i} style={{ flexGrow: 1, flexBasis: isPhone ? '100%' : 300, gap: 10 }}>
          <Skeleton width="40%" height={14} />
          <Skeleton width="30%" height={28} />
          <Skeleton width="70%" height={12} />
        </Card>
      ))}
    </View>
  );
}
