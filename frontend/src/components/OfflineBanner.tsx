import React from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme/ThemeProvider';
import { useNet, syncNow } from '@/lib/sync';
import { useOutbox } from '@/store/outbox';
import { Text } from './ui/Text';
import { t } from '@/i18n';

/** Thin status strip: offline / pending bills / bills that need attention. Billing never blocks on it. */
export function OfflineBanner() {
  const { colors } = useTheme();
  const online = useNet((s) => s.online && s.serverReachable);
  const queue = useOutbox((s) => s.queue);
  const pending = queue.filter((q) => !q.failed).length;
  const failed = queue.filter((q) => q.failed).length;

  if (online && pending === 0 && failed === 0) return null;

  const tone = failed ? colors.dangerSoft : online ? colors.infoSoft : colors.warningSoft;
  const fg = failed ? colors.dangerText : online ? colors.infoText : colors.warningText;
  const message = failed
    ? t('shell.OfflineBanner.failed_offline_bill_v_could_not_be_saved', { failed, v: failed > 1 ? 's' : '' })
    : !online
      ? t('shell.OfflineBanner.you_re_offline_billing_continues_v', { v: pending ? t('shell.OfflineBanner.pending_bill_v_waiting_to_sync', { pending, v: pending > 1 ? 's' : '' }) : '' })
      : t('shell.OfflineBanner.syncing_pending_offline_bill_v', { pending, v: pending > 1 ? 's' : '' });

  return (
    <Pressable onPress={() => void syncNow()} accessibilityRole="button" accessibilityLabel={t('shell.OfflineBanner.message_tap_to_retry_sync', { message })}
      style={{ backgroundColor: tone, paddingVertical: 8, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Ionicons name={failed ? 'alert-circle' : online ? 'sync' : 'cloud-offline'} size={16} color={fg} />
      <View style={{ flex: 1 }}>
        <Text variant="smallStrong" color={fg} numberOfLines={2}>{message}</Text>
      </View>
      <Text variant="caption" color={fg}>{t('shell.OfflineBanner.retry')}</Text>
    </Pressable>
  );
}
