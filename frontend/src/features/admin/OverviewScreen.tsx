/** Platform overview: how many businesses, which plans and types, revenue and renewals this month. */
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { platformApi } from '@/api/platform';
import { Button, Card, ErrorState, Loading, Stat, Text, type TextTone } from '@/components/ui';
import { useApi } from '@/hooks/useApi';
import { ago, money } from '@/lib/format';
import { useAuth } from '@/store/auth';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { OnboardBusinessSheet } from './OnboardBusinessSheet';
import { AdminPage, BUSINESS_TYPE_ICON, BUSINESS_TYPE_LABEL, ShareBar, goTo, setPendingPayments, useCanEdit, usePendingOwnerRequests } from './shared';
import { brand } from '@/config/brand';
import { t, currentLocale } from '@/i18n';

export default function OverviewScreen() {
  const { colors } = useTheme();
  const { width } = useLayout();
  const canEdit = useCanEdit();
  const name = useAuth((s) => s.session?.fullName ?? null);
  const overview = useApi(() => platformApi.overview(), []);
  const plans = useApi(() => platformApi.plans(), []);
  const [onboarding, setOnboarding] = useState(false);
  const ownerRequests = usePendingOwnerRequests((s) => s.count);

  useEffect(() => {
    if (overview.data) setPendingPayments(overview.data.pending_payment_requests ?? 0);
  }, [overview.data]);

  const data = overview.data;
  const active = data?.businesses.active ?? 0;
  const suspended = data?.businesses.suspended ?? 0;
  const closed = data?.businesses.deleted ?? 0;
  const planName = (key: string) => plans.data?.plans.find((p) => p.key === key)?.name ?? key;
  const planOrder = (key: string) => plans.data?.plans.findIndex((p) => p.key === key) ?? 0;
  const byPlan = Object.entries(data?.by_plan ?? {}).sort((a, b) => planOrder(a[0]) - planOrder(b[0]));
  const byType = Object.entries(data?.by_type ?? {}).sort((a, b) => b[1] - a[1]);
  const typeTotal = byType.reduce((n, [, v]) => n + v, 0);
  const planColors = [colors.info, colors.primary, colors.accent, colors.success, colors.danger];
  const twoCol = width >= 980;
  const month = new Date().toLocaleDateString(currentLocale(), { month: 'long' });

  return (
    <AdminPage
      title={t('common.overview')}
      subtitle={t('admin.OverviewScreen.v_every_business_on_brand_at_a_glance', { v: name ? t('admin.OverviewScreen.welcome_back_v', { v: name.split(' ')[0] }) : '', brand: brand.name })}
      refreshing={overview.refreshing}
      onRefresh={() => { void overview.reload(); void plans.reload(); }}
      actions={canEdit ? <Button title={t('admin.OverviewScreen.onboard_business')} icon="add" onPress={() => setOnboarding(true)} /> : null}
    >
      {overview.loading && !data ? <Loading label={t('admin.OverviewScreen.loading_overview')} /> : null}
      {overview.error && !data ? <ErrorState message={overview.error} onRetry={overview.reload} /> : null}

      {data ? (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
            <Stat label={t('admin.OverviewScreen.active_businesses')} value={active.toLocaleString(currentLocale())} icon="storefront-outline"
              hint={closed ? t('admin.OverviewScreen.closed_closed_by_owner', { closed }) : t('admin.OverviewScreen.billing_on_brand_now', { brand: brand.name })} />
            <Stat label={t('common.suspended')} value={suspended.toLocaleString(currentLocale())} icon="pause-circle-outline" tone={suspended ? 'danger' : 'default'}
              hint={suspended ? t('admin.OverviewScreen.cannot_sign_in_or_bill') : t('admin.OverviewScreen.none_suspended')} />
            <Stat label={t('admin.OverviewScreen.new_this_month')} value={data.new_this_month.toLocaleString(currentLocale())} icon="sparkles-outline" hint={t('admin.OverviewScreen.signed_up_in_month', { month })} />
            <Stat label={t('admin.OverviewScreen.revenue_this_month')} value={money(data.revenue_this_month, '₹', true)} icon="wallet-outline" tone="success" hint={t('admin.OverviewScreen.recorded_payments')} />
            <Stat label={t('admin.OverviewScreen.renewals_due_in_7_days')} value={data.renewals_due_7_days.toLocaleString(currentLocale())} icon="alarm-outline"
              tone={data.renewals_due_7_days ? 'warning' : 'default'} hint={t('admin.OverviewScreen.paid_until_ends_soon')} />
          </View>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
            <StatLink label={t('common.locked')} value={(data.locked ?? 0).toLocaleString(currentLocale())} icon="lock-closed-outline" tone={data.locked ? 'danger' : 'default'}
              hint={data.locked ? t('admin.OverviewScreen.subscription_ended_see_renewal_page') : t('admin.OverviewScreen.nobody_is_locked_out')} onPress={() => goTo('/admin/businesses?access=locked')} />
            <StatLink label={t('admin.OverviewScreen.pending_payments')} value={(data.pending_payment_requests ?? 0).toLocaleString(currentLocale())} icon="wallet-outline"
              tone={data.pending_payment_requests ? 'warning' : 'default'} hint={data.pending_payment_requests ? t('admin.OverviewScreen.owners_say_they_paid_review') : t('admin.OverviewScreen.no_claims_waiting')}
              onPress={() => goTo('/admin/payments')} />
            <StatLink label={t('common.owner_requests')} value={(ownerRequests ?? 0).toLocaleString(currentLocale())} icon="mail-unread-outline"
              tone={ownerRequests ? 'warning' : 'default'} hint={ownerRequests ? t('admin.OverviewScreen.archive_delete_bills_review') : t('admin.OverviewScreen.no_requests_waiting')}
              onPress={() => goTo('/admin/requests')} />
            <StatLink label={t('admin.OverviewScreen.daily_check')} icon="time-outline" onPress={() => goTo('/admin/settings')}
              value={data.last_subscription_check ? `${ago(data.last_subscription_check.last_run_at)} ago` : 'Never'}
              hint={data.last_subscription_check ? t('admin.OverviewScreen.locked_now_locked_renewals_due_soon_due', { locked_now: data.last_subscription_check.locked_now, renewals_due_soon: data.last_subscription_check.renewals_due_soon }) : t('admin.OverviewScreen.runs_at_01_00_india_time')} />
          </View>

          <View style={{ flexDirection: twoCol ? 'row' : 'column', gap: 16, alignItems: 'flex-start' }}>
            <Card style={{ gap: 14, flex: twoCol ? 1 : undefined, alignSelf: 'stretch' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Text variant="h3">{t('admin.OverviewScreen.active_businesses_by_plan')}</Text>
                  <Text variant="small" tone="muted">{t('admin.OverviewScreen.suspended_and_closed_businesses_are_not')}</Text>
                </View>
                <Button title={t('admin.OverviewScreen.plans')} size="sm" variant="ghost" iconRight="chevron-forward" onPress={() => goTo('/admin/plans')} />
              </View>
              {byPlan.length === 0 ? <Text tone="muted">{t('admin.OverviewScreen.no_active_businesses_yet')}</Text> : null}
              {byPlan.map(([key, count], i) => (
                <ShareBar key={key} label={planName(key)} value={count} total={active} color={planColors[i % planColors.length]} icon="pricetag-outline" />
              ))}
            </Card>
            <Card style={{ gap: 14, flex: twoCol ? 1 : undefined, alignSelf: 'stretch' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Text variant="h3">{t('admin.OverviewScreen.businesses_by_type')}</Text>
                  <Text variant="small" tone="muted">{t('admin.OverviewScreen.all_signed_up_businesses_including_closed')}</Text>
                </View>
                <Button title={t('common.businesses')} size="sm" variant="ghost" iconRight="chevron-forward" onPress={() => goTo('/admin/businesses')} />
              </View>
              {byType.length === 0 ? <Text tone="muted">{t('admin.OverviewScreen.no_businesses_yet')}</Text> : null}
              {byType.map(([type, count]) => (
                <ShareBar key={type} label={BUSINESS_TYPE_LABEL[type] ?? type} value={count} total={typeTotal} icon={BUSINESS_TYPE_ICON[type] ?? 'business-outline'} />
              ))}
            </Card>
          </View>

          <Card style={{ gap: 4 }}>
            <Text variant="h3">{t('admin.OverviewScreen.quick_links')}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
              <Button title={t('admin.OverviewScreen.suspended_businesses')} icon="pause-circle-outline" variant="secondary" size="sm" onPress={() => goTo('/admin/businesses?status=suspended')} />
              <Button title={t('common.gst_rate_library')} icon="receipt-outline" variant="secondary" size="sm" onPress={() => goTo('/admin/tax')} />
              <Button title={t('admin.OverviewScreen.recent_platform_actions')} icon="time-outline" variant="secondary" size="sm" onPress={() => goTo('/admin/audit')} />
            </View>
          </Card>
        </>
      ) : null}

      {onboarding ? (
        <OnboardBusinessSheet plans={plans.data?.plans ?? []} onClose={() => setOnboarding(false)} onDone={() => void overview.silentReload()} />
      ) : null}
    </AdminPage>
  );
}

/** A stat tile that opens a filtered view. */
function StatLink({ label, value, hint, icon, tone = 'default', onPress }: {
  label: string; value: string; hint?: string; icon: keyof typeof Ionicons.glyphMap; tone?: TextTone; onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Card onPress={onPress} style={{ flex: 1, minWidth: 180, gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Ionicons name={icon} size={16} color={colors.textSubtle} />
        <Text variant="small" tone="muted" numberOfLines={1} style={{ flex: 1 }}>{label}</Text>
        <Ionicons name="chevron-forward" size={16} color={colors.textSubtle} />
      </View>
      <Text variant="h1" tone={tone} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      {hint ? <Text variant="small" tone="subtle" numberOfLines={1}>{hint}</Text> : null}
    </Card>
  );
}
