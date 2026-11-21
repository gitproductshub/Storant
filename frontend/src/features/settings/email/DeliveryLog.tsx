/** Delivery log: what was sent to whom, with status counts and the reason for failures. */
import React, { useState } from 'react';
import { View } from 'react-native';
import { emailApi, type EmailLogStatus, type EmailTemplate } from '@/api/email';
import { Badge, Button, Card, Chip, EmptyState, ErrorState, Loading, Text, type BadgeTone } from '@/components/ui';
import { useApi } from '@/hooks/useApi';
import { formatDateTime } from '@/lib/format';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { t as tr } from '@/i18n';

const STATUS: Record<EmailLogStatus, { label: string; tone: BadgeTone; hint: string }> = {
  sent: { get label() { return tr('common.sent'); }, tone: 'success', get hint() { return tr('settings.email_DeliveryLog.handed_to_the_mail_server'); } },
  queued: { get label() { return tr('settings.email_DeliveryLog.queued'); }, tone: 'info', get hint() { return tr('settings.email_DeliveryLog.waiting_to_be_sent_usually_a_few_seconds'); } },
  failed: { get label() { return tr('settings.email_DeliveryLog.failed'); }, tone: 'danger', get hint() { return tr('settings.email_DeliveryLog.the_mail_server_refused_it'); } },
  skipped: { get label() { return tr('settings.email_DeliveryLog.skipped'); }, tone: 'warning', get hint() { return tr('settings.email_DeliveryLog.not_sent_because_email_is_not_set_up'); } },
};
const ORDER: EmailLogStatus[] = ['sent', 'queued', 'failed', 'skipped'];

export function DeliveryLog({ templates }: { templates: EmailTemplate[] }) {
  const { colors } = useTheme();
  const { isPhone } = useLayout();
  const [status, setStatus] = useState<EmailLogStatus | null>(null);
  const { data, error, loading, refreshing, reload } = useApi(() => emailApi.logs(status), [status], { intervalMs: 15000 });
  const label = (key: string) => templates.find((t) => t.key === key)?.label ?? key.replace(/_/g, ' ');
  const counts = data?.counts ?? {};
  const total = ORDER.reduce((n, s) => n + (counts[s] ?? 0), 0);

  return (
    <View style={{ gap: 14 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <Chip label={tr('common.all')} count={total} selected={status === null} onPress={() => setStatus(null)} />
        {ORDER.map((s) => (
          <Chip key={s} label={STATUS[s].label} count={counts[s] ?? 0} selected={status === s} onPress={() => setStatus(s)} />
        ))}
        <View style={{ flex: 1 }} />
        <Button title={isPhone ? undefined : tr('common.refresh')} icon="refresh" variant="ghost" size="sm" onPress={reload} loading={refreshing} accessibilityLabel={tr('settings.email_DeliveryLog.refresh_delivery_log')} />
      </View>

      {loading && !data ? <Loading label={tr('settings.email_DeliveryLog.loading_delivery_log')} /> : !data ? (
        <ErrorState message={error ?? tr('settings.email_DeliveryLog.could_not_load_the_delivery_log')} onRetry={reload} />
      ) : !data.items.length ? (
        <Card>
          <EmptyState icon="mail-open-outline" title={status ? tr('settings.email_DeliveryLog.no_tolowercase_emails', { toLowerCase: STATUS[status].label.toLowerCase() }) : tr('settings.email_DeliveryLog.no_emails_yet')}
            message={status ? STATUS[status].hint : tr('settings.email_DeliveryLog.emails_to_customers_receipts_rewards')} />
        </Card>
      ) : (
        <Card padded={false}>
          {data.items.map((item, i) => {
            const st = STATUS[item.status] ?? { label: item.status, tone: 'neutral' as BadgeTone, hint: '' };
            return (
              <View key={item.id} style={{ flexDirection: isPhone ? 'column' : 'row', gap: isPhone ? 4 : 12, paddingHorizontal: 16, paddingVertical: 12,
                borderTopWidth: i ? 1 : 0, borderTopColor: colors.divider }}>
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <Text variant="bodyStrong" numberOfLines={1}>{item.subject}</Text>
                  <Text variant="small" tone="muted" numberOfLines={1}>{item.to} · {label(item.template)}</Text>
                  {item.error ? <Text variant="small" tone={item.status === 'failed' ? 'danger' : 'warning'} numberOfLines={3}>{item.error}</Text> : null}
                </View>
                <View style={{ alignItems: isPhone ? 'flex-start' : 'flex-end', gap: 4, flexDirection: isPhone ? 'row' : 'column' }}>
                  <Badge label={st.label} tone={st.tone} />
                  <Text variant="caption" tone="subtle">{formatDateTime(item.sent_at ?? item.created_at)}</Text>
                </View>
              </View>
            );
          })}
        </Card>
      )}
      {data && data.items.length >= 100 ? <Text variant="small" tone="subtle">{tr('settings.email_DeliveryLog.showing_the_latest_100')}</Text> : null}
    </View>
  );
}
