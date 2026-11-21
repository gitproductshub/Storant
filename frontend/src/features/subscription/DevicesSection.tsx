/** Settings → Account → "Signed-in devices": where this login is signed in, with "Sign out" per device. */
import React, { useState } from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { errorMessage } from '@/api/client';
import { sessionsApi, type DeviceSession } from '@/api/subscription';
import { Badge, Button, ErrorState, Loading, Text, confirm, toast } from '@/components/ui';
import { FormSection, Hairline } from '@/features/settings/components';
import { useApi } from '@/hooks/useApi';
import { ago, formatDateTime } from '@/lib/format';
import { useTheme } from '@/theme/ThemeProvider';
import { t } from '@/i18n';

function deviceIcon(device: string): React.ComponentProps<typeof Ionicons>['name'] {
  if (/android|iphone|ipad|app/i.test(device)) return 'phone-portrait-outline';
  if (/windows|mac|linux|chrome|edge|firefox|safari|browser/i.test(device)) return 'desktop-outline';
  return 'hardware-chip-outline';
}

function DeviceRow({ s, busy, onSignOut }: { s: DeviceSession; busy: boolean; onSignOut: () => void }) {
  const { colors } = useTheme();
  const seen = s.last_seen_at ?? s.created_at;
  const seenText = ago(seen);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52 }}>
      <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={deviceIcon(s.device)} size={18} color={colors.textMuted} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Text variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>{s.device || t('subscription.DevicesSection.unknown_device')}</Text>
          {s.current ? <Badge label={t('common.this_device')} tone="primary" /> : null}
        </View>
        <Text variant="small" tone="muted" numberOfLines={1}>
          {s.current ? t('subscription.DevicesSection.active_now') : t('subscription.DevicesSection.last_active_v', { v: seenText === 'just now' ? t('subscription.DevicesSection.just_now') : t('subscription.DevicesSection.seentext_ago', { seenText }) })}
          {s.ip ? ` · ${s.ip}` : ''} {t('subscription.DevicesSection.signed_in_formatdatetime', { formatDateTime: formatDateTime(s.created_at) })}
        </Text>
      </View>
      {!s.current ? <Button title={t('common.sign_out')} size="sm" variant="secondary" onPress={onSignOut} loading={busy} /> : null}
    </View>
  );
}

export function DevicesSection({ refreshKey = 0 }: { refreshKey?: number }) {
  const list = useApi(() => sessionsApi.list(), [refreshKey], { refetchOnFocus: true });
  const [busyId, setBusyId] = useState<string | null>(null);
  const sessions = [...(list.data ?? [])].sort((a, b) => Number(b.current) - Number(a.current)); // this device first
  const others = sessions.filter((s) => !s.current);

  const signOutDevice = async (s: DeviceSession) => {
    const ok = await confirm({
      title: t('subscription.DevicesSection.sign_out_this_device'),
      message: t('subscription.DevicesSection.v_will_be_signed_out_right_away_bills_it', { v: s.device || t('common.this_device') }),
      confirmLabel: t('subscription.DevicesSection.sign_out_device'),
      danger: true,
    });
    if (!ok) return;
    setBusyId(s.id);
    try {
      await sessionsApi.signOutDevice(s.id);
      list.setData((prev) => (prev ?? []).filter((x) => x.id !== s.id));
      toast.success(t('subscription.DevicesSection.device_signed_out'));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusyId(null);
    }
  };

  const signOutOthers = async () => {
    const ok = await confirm({
      title: t('subscription.DevicesSection.sign_out_length_other_device_v', { length: others.length, v: others.length === 1 ? '' : 's' }),
      message: t('subscription.DevicesSection.every_other_device_using_your_login_is'),
      confirmLabel: t('subscription.DevicesSection.sign_out_others'),
      danger: true,
    });
    if (!ok) return;
    setBusyId('others');
    let failed = 0;
    for (const s of others) {
      try {
        await sessionsApi.signOutDevice(s.id);
      } catch {
        failed += 1;
      }
    }
    setBusyId(null);
    if (failed) toast.error(t('subscription.DevicesSection.failed_device_v_could_not_be_signed_out', { failed, v: failed === 1 ? '' : 's' }));
    else toast.success(t('subscription.DevicesSection.other_devices_signed_out'));
    void list.silentReload();
  };

  return (
    <FormSection title={t('subscription.DevicesSection.signed_in_devices')} description={t('subscription.DevicesSection.where_your_login_is_signed_in_changing')}
      right={others.length > 1 ? <Button title={t('subscription.DevicesSection.sign_out_all_others')} size="sm" variant="ghost" onPress={signOutOthers} loading={busyId === 'others'} /> : undefined}>
      {list.loading && !list.data ? <Loading /> : null}
      {list.error && !list.data ? <ErrorState message={list.error} onRetry={list.reload} /> : null}
      {list.data && !sessions.length ? <Text tone="muted">{t('subscription.DevicesSection.no_other_devices_are_signed_in')}</Text> : null}
      {sessions.map((s, i) => (
        <View key={s.id} style={{ gap: 10 }}>
          {i > 0 ? <Hairline /> : null}
          <DeviceRow s={s} busy={busyId === s.id} onSignOut={() => void signOutDevice(s)} />
        </View>
      ))}
    </FormSection>
  );
}
