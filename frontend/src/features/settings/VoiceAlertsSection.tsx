/**
 * Settings → Account → Voice alerts (this device only; no business-wide setting). Kitchen: say new orders, optionally with
 * the items. Floor staff: say when a dine-in table's food is ready, remind every 30 s / 1 min / 2 min until it is served,
 * only my tables or all. Pick the Hindi voice and test it. Spoken text is always Hindi (lib/voiceLines.ts).
 */
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button, SwitchRow, Text } from '@/components/ui';
import { useCan } from '@/store/access';
import { REMINDER_CHOICES, isMuted, useVoicePrefs, type ReminderSeconds } from '@/store/voicePrefs';
import { deviceVoices, hindiVoices, onVoicesChanged, pickVoice, sayNow, voiceAvailable, type VoiceInfo } from '@/lib/voice';
import { TEST_LINE } from '@/lib/voiceLines';
import { currentLocale, t } from '@/i18n';
import { Callout, ChoiceChips, FormSection } from './components';

const REMINDER_LABEL: Record<ReminderSeconds, () => string> = {
  30: () => t('settings.VoiceAlertsSection.reminder_30'),
  60: () => t('settings.VoiceAlertsSection.reminder_60'),
  120: () => t('settings.VoiceAlertsSection.reminder_120'),
  0: () => t('settings.VoiceAlertsSection.reminder_off'),
};

export function VoiceAlertsSection() {
  const prefs = useVoicePrefs();
  const kitchen = useCan('kitchen.view', 'kitchen');
  const floor = useCan('tables.view', 'tables');
  const available = voiceAvailable();
  const [voices, setVoices] = useState<VoiceInfo[]>(() => (available ? deviceVoices() : []));
  useEffect(() => {
    if (!available) return undefined;
    setVoices(deviceVoices());
    return onVoicesChanged(() => setVoices(deviceVoices())); // browsers often load voices a moment later
  }, [available]);

  if (!kitchen && !floor) return null;
  const hindi = hindiVoices(voices);
  const chosen = pickVoice(voices, prefs.voiceUri);
  const now = Date.now();
  const muted = isMuted(prefs.mutedUntil, now);

  return (
    <FormSection title={t('settings.VoiceAlertsSection.voice_alerts')} description={t('settings.VoiceAlertsSection.description')}>
      {!available ? (
        <Callout tone="info" icon="mic-off-outline">{t('settings.VoiceAlertsSection.not_available')}</Callout>
      ) : (
        <View style={{ gap: 12 }}>
          {kitchen ? (
            <>
              <SwitchRow title={t('settings.VoiceAlertsSection.kitchen_voice')} subtitle={t('settings.VoiceAlertsSection.kitchen_voice_desc')}
                value={prefs.kitchenVoice} onValueChange={(v) => prefs.set({ kitchenVoice: v })} />
              <SwitchRow title={t('settings.VoiceAlertsSection.kitchen_items')} subtitle={t('settings.VoiceAlertsSection.kitchen_items_desc')}
                value={prefs.kitchenItems} onValueChange={(v) => prefs.set({ kitchenItems: v })} disabled={!prefs.kitchenVoice} />
            </>
          ) : null}
          {floor ? (
            <>
              <SwitchRow title={t('settings.VoiceAlertsSection.ready_voice')} subtitle={t('settings.VoiceAlertsSection.ready_voice_desc')}
                value={prefs.readyVoice} onValueChange={(v) => prefs.set({ readyVoice: v })} />
              <View style={{ gap: 6, opacity: prefs.readyVoice ? 1 : 0.5 }} pointerEvents={prefs.readyVoice ? 'auto' : 'none'}>
                <Text variant="smallStrong">{t('settings.VoiceAlertsSection.reminder')}</Text>
                <ChoiceChips<ReminderSeconds> value={prefs.reminderSeconds} onChange={(v) => prefs.set({ reminderSeconds: v })}
                  accessibilityLabel={t('settings.VoiceAlertsSection.reminder')}
                  options={REMINDER_CHOICES.map((s) => ({ value: s, label: REMINDER_LABEL[s]() }))} />
              </View>
              <SwitchRow title={t('settings.VoiceAlertsSection.only_mine')} subtitle={t('settings.VoiceAlertsSection.only_mine_desc')}
                value={prefs.onlyMyTables} onValueChange={(v) => prefs.set({ onlyMyTables: v })} disabled={!prefs.readyVoice} />
            </>
          ) : null}

          <View style={{ gap: 6 }}>
            <Text variant="smallStrong">{t('settings.VoiceAlertsSection.voice')}</Text>
            {hindi.length ? (
              <ChoiceChips<string> value={prefs.voiceUri && hindi.some((v) => v.uri === prefs.voiceUri) ? prefs.voiceUri : ''}
                onChange={(v) => prefs.set({ voiceUri: v || null })} accessibilityLabel={t('settings.VoiceAlertsSection.voice')}
                options={[{ value: '', label: t('settings.VoiceAlertsSection.voice_auto') }, ...hindi.map((v) => ({ value: v.uri, label: v.name }))]} />
            ) : (
              <Callout tone="warning" icon="warning-outline">{t('settings.VoiceAlertsSection.no_hindi_voice')}</Callout>
            )}
            {chosen ? <Text variant="caption" tone="muted">{t('settings.VoiceAlertsSection.using_voice', { name: chosen.name })}</Text> : null}
          </View>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <Button title={t('settings.VoiceAlertsSection.test')} icon="volume-high-outline" variant="outline" onPress={() => sayNow(TEST_LINE)} />
            {muted ? (
              <>
                <Text variant="small" tone="muted">
                  {t('settings.VoiceAlertsSection.muted_until', { time: new Date(prefs.mutedUntil).toLocaleTimeString(currentLocale(), { hour: '2-digit', minute: '2-digit' }) })}
                </Text>
                <Button title={t('ops.FloorAnnouncer.unmute')} size="sm" variant="ghost" onPress={() => prefs.mute(Date.now(), 0)} />
              </>
            ) : null}
          </View>
        </View>
      )}
    </FormSection>
  );
}
