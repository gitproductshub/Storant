/**
 * Settings → Plan & billing (owner): current plan and state, days left, payment claims, history,
 * and the same renewal flow as the lock screen — while the business is still running.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { errorMessage } from '@/api/client';
import { Badge, Button, Card, EmptyState, ErrorState, Loading, Text } from '@/components/ui';
import { SettingsFrame } from '@/features/settings/SettingsFrame';
import { Callout, FormSection } from '@/features/settings/components';
import { formatDate } from '@/lib/format';
import { useAuth } from '@/store/auth';
import { useSubscription } from '@/store/subscription';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { HistoryList, RenewFlow, RequestsList, SupportLinks } from './RenewFlow';
import { KIND_LABEL, STATE_LABEL, STATE_TONE, daysText, liveDaysLeft, monthsText, currentPeriod } from './format';
import { brand } from '@/config/brand';
import { t } from '@/i18n';

function SummaryTile({ label, value, hint, icon }: { label: string; value: string; hint?: string; icon: React.ComponentProps<typeof Ionicons>['name'] }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexGrow: 1, flexBasis: 180, minWidth: 0, gap: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Ionicons name={icon} size={15} color={colors.textMuted} />
        <Text variant="caption" tone="muted" style={{ textTransform: 'uppercase' }}>{label}</Text>
      </View>
      <Text variant="h2" numberOfLines={1}>{value}</Text>
      {hint ? <Text variant="small" tone="muted" numberOfLines={2}>{hint}</Text> : null}
    </View>
  );
}

export default function BillingScreen() {
  const role = useAuth((s) => s.session?.role ?? null);
  const info = useSubscription((s) => s.info);
  const { isPhone } = useLayout();
  const [loading, setLoading] = useState(!info);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renewOpen, setRenewOpen] = useState(false);

  const load = useCallback(async (mode: 'initial' | 'refresh' | 'silent' = 'silent') => {
    if (mode === 'refresh') setRefreshing(true);
    try {
      await useSubscription.getState().refresh();
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (role === 'owner') void load('initial');
  }, [role, load]);

  if (role !== 'owner') {
    return (
      <SettingsFrame active="billing" title={t('common.plan_billing')}>
        <EmptyState icon="lock-closed-outline" title={t('subscription.BillingScreen.only_the_owner_can_manage_the_plan')} message={t('subscription.BillingScreen.ask_the_owner_of_this_business_to_renew', { brand: brand.name })} />
      </SettingsFrame>
    );
  }

  const left = liveDaysLeft(info);
  const period = info ? currentPeriod(info.history) : null;
  const pending = info?.requests.filter((r) => r.status === 'pending') ?? [];
  const rejected = info?.requests.find((r) => r.status === 'rejected');
  const showRenewOpen = renewOpen || (!!info && (info.state === 'trial' || info.state === 'grace' || (left !== null && left <= 14)));

  return (
    <SettingsFrame active="billing" title={t('common.plan_billing')} subtitle={t('subscription.BillingScreen.your_brand_subscription_renewals_and', { brand: brand.name })}
      refreshing={refreshing} onRefresh={() => void load('refresh')}
      actions={info ? <Button title={t('common.refresh')} icon="refresh" variant="ghost" size="sm" onPress={() => void load('refresh')} loading={refreshing} /> : undefined}>
      {loading && !info ? <Loading label={t('subscription.BillingScreen.loading_your_plan')} /> : null}
      {error && !info ? <ErrorState message={error} onRetry={() => void load('refresh')} /> : null}

      {info ? (
        <>
          <Card style={{ gap: 16 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <Text variant="h2" style={{ flexShrink: 1 }}>{info.plan_name} {t('subscription.BillingScreen.plan')}</Text>
              <Badge label={STATE_LABEL[info.state]} tone={STATE_TONE[info.state]} icon={info.state === 'development' ? 'construct-outline' : undefined} />
              {info.kind && info.kind !== 'development' && info.kind !== 'trial' ? <Badge label={KIND_LABEL[info.kind] ?? info.kind} tone="neutral" /> : null}
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: isPhone ? 14 : 24 }}>
              <SummaryTile icon="calendar-outline" label={info.state === 'grace' ? t('subscription.BillingScreen.ended_on') : t('subscription.BillingScreen.valid_until')}
                value={info.state === 'development' ? 'No expiry' : info.paid_until ? formatDate(info.paid_until) : '—'}
                hint={info.state === 'grace' && info.lock_at ? t('subscription.BillingScreen.access_stops_on_formatdate', { formatDate: formatDate(info.lock_at) }) : undefined} />
              <SummaryTile icon="hourglass-outline" label={t('subscription.BillingScreen.days_left')}
                value={info.state === 'development' ? '—' : left === null ? '—' : left <= 0 ? 'Ends today' : String(left)}
                hint={info.state === 'development' ? t('common.development_access') : left !== null && left > 0 ? daysText(left) : undefined} />
              <SummaryTile icon="receipt-outline" label={t('subscription.BillingScreen.current_period')}
                value={period ? (period.months ? monthsText(period.months) : KIND_LABEL[period.kind] ?? period.kind) : '—'}
                hint={period ? `${formatDate(period.start_date)} – ${formatDate(period.end_date)}` : undefined} />
            </View>
            {info.state === 'development' ? (
              <Callout tone="info" icon="construct-outline" title={t('common.development_access')}>
                {t('subscription.BillingScreen.brand_switched_this_business_on_without', { brand: brand.name })}
              </Callout>
            ) : info.state === 'grace' ? (
              <Callout tone="danger" title={t('common.payment_due')}>
                {t('subscription.BillingScreen.your_subscription_ended_v_renew_before_v2', { v: info.paid_until ? t('subscription.BillingScreen.on_formatdate', { formatDate: formatDate(info.paid_until) }) : '', v2: info.lock_at ? formatDate(info.lock_at) : t('subscription.BillingScreen.access_stops') })}
              </Callout>
            ) : info.state === 'trial' ? (
              <Callout tone="info" title={t('subscription.BillingScreen.you_re_on_the_free_demo')}>
                {t('subscription.BillingScreen.everything_is_switched_on_during_the_demo', { v: left !== null ? ` (${daysText(left)})` : '' })}
              </Callout>
            ) : null}
          </Card>

          {pending.length || rejected ? (
            <FormSection title={t('common.payments')} description={t('subscription.BillingScreen.payments_you_told_us_about_brand_confirms', { brand: brand.name })}>
              {pending.length ? (
                <Callout tone="info" title={t('subscription.BillingScreen.waiting_for_confirmation')}>{t('subscription.BillingScreen.your_plan_is_extended_as_soon_as_brand', { brand: brand.name })}</Callout>
              ) : null}
              <RequestsList requests={info.requests} plans={info.plans} />
            </FormSection>
          ) : null}

          {/* Development access has no end date (a renewal would start after it), so there is nothing to buy until Storant removes it */}
          {info.can_pay && info.state !== 'development' ? (
            <View style={{ gap: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <View style={{ flex: 1, minWidth: 200 }}>
                  <Text variant="h3" accessibilityRole="header">{t('subscription.BillingScreen.renew_or_change_plan')}</Text>
                  <Text variant="small" tone="muted">{t('subscription.BillingScreen.a_renewal_starts_when_the_current_period')}</Text>
                </View>
                {!showRenewOpen ? <Button title={t('subscription.BillingScreen.renew_now')} icon="card-outline" onPress={() => setRenewOpen(true)} /> : null}
              </View>
              {showRenewOpen ? <RenewFlow info={info} onSubmitted={() => void load('silent')} allowTwoColumns={false} /> : null}
            </View>
          ) : null}

          <FormSection title={t('subscription.BillingScreen.history')} description={t('subscription.BillingScreen.demo_paid_and_complimentary_periods_of')}>
            <HistoryList history={info.history} />
          </FormSection>

          <FormSection title={t('subscription.BillingScreen.billing_support')} description={t('subscription.BillingScreen.questions_about_plans_or_payments')}>
            <SupportLinks payment={info.payment} />
          </FormSection>
        </>
      ) : null}
    </SettingsFrame>
  );
}
