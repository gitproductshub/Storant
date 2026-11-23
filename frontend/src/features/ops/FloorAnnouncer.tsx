/**
 * Voice alerts for floor staff (waiter, cashier, manager, owner), on every screen of the app: "टेबल 5 का ऑर्डर तैयार है।"
 * when a dine-in ticket's food is all ready, then "याद दिलाना: …" every 30 s / 1 min / 2 min until it is served.
 * Decisions live in ./announcer.ts; the voice in lib/voice.ts. Per-device settings: store/voicePrefs.ts.
 *
 * Shows a small pill while food is waiting: how many tables, "Mute 5 min" / unmute, and (when the browser still needs a
 * first tap before it may speak) "Tap to turn on voice". Keeps the screen awake while voice alerts are on.
 * Works where the device can speak (web / PWA); the native apps have no voice engine yet, so it stays off there.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { readyToServeApi, type ReadyToServeEntry } from '@/api/floor';
import { Button, Text } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { useAccessInfo, useCan } from '@/store/access';
import { isMuted, useVoicePrefs } from '@/store/voicePrefs';
import { hush, say, sayNow, useWakeLock, voiceAvailable, voiceNeedsTap } from '@/lib/voice';
import { VOICE_ON_LINE } from '@/lib/voiceLines';
import { announcerStep, initialAnnouncer, visibleEntries, type AnnouncerState } from './announcer';
import { t } from '@/i18n';

const POLL_MS = 10_000;
const TICK_MS = 5_000;

const pageVisible = () => Platform.OS !== 'web' || typeof document === 'undefined' || document.visibilityState === 'visible';

export function FloorAnnouncer() {
  const canSee = useCan('tables.view', 'tables');
  const readyVoice = useVoicePrefs((s) => s.readyVoice);
  const active = canSee && readyVoice && voiceAvailable();
  useWakeLock(active);
  if (!active) return null;
  return <Announcer />;
}

function Announcer() {
  const { colors, radius, shadow } = useTheme();
  const reminderSeconds = useVoicePrefs((s) => s.reminderSeconds);
  const onlyMyTables = useVoicePrefs((s) => s.onlyMyTables);
  const mutedUntil = useVoicePrefs((s) => s.mutedUntil);
  const mute = useVoicePrefs((s) => s.mute);
  const myStaffId = useAccessInfo()?.staff_id ?? null;
  const [entries, setEntries] = useState<ReadyToServeEntry[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [tapped, setTapped] = useState(false);
  const state = useRef<AnnouncerState>(initialAnnouncer());
  /** Server clock minus this device's clock, so a device with a wrong clock still times reminders right. */
  const skew = useRef(0);

  // Poll while the page is visible
  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (!pageVisible()) return;
      try {
        const body = await readyToServeApi.list();
        if (!alive) return;
        const server = Date.parse(body.server_time);
        if (Number.isFinite(server)) skew.current = server - Date.now();
        setEntries(body.items);
      } catch {
        /* offline or not allowed: try again on the next tick */
      }
    };
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    const onVisible = () => { if (pageVisible()) void load(); };
    if (Platform.OS === 'web' && typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      clearInterval(timer);
      if (Platform.OS === 'web' && typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // Reminders come due between polls too
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const mine = visibleEntries(entries, { onlyMine: onlyMyTables, myStaffId });
  const step = useCallback((list: ReadyToServeEntry[], at: number) => {
    const serverNow = at + skew.current;
    const result = announcerStep(state.current, list, serverNow, { reminderMs: reminderSeconds * 1000, muted: isMuted(mutedUntil, at) });
    state.current = result.state;
    for (const line of result.lines) say(line, at);
  }, [reminderSeconds, mutedUntil]);

  useEffect(() => {
    step(mine, Date.now());
    // `mine` is derived from entries / settings; `now` drives the reminder ticks
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, onlyMyTables, myStaffId, now, step]);

  if (!mine.length) return null;
  const muted = isMuted(mutedUntil, now);
  const needsTap = !tapped && voiceNeedsTap();
  const tables = [...new Set(mine.map((e) => e.table_label))];

  return (
    <View pointerEvents="box-none" style={styles.wrap}>
      <View style={[styles.pill, shadow(2), { backgroundColor: colors.surface, borderColor: colors.successText, borderRadius: radius.lg }]}
        accessibilityLiveRegion="polite" testID="floor-announcer">
        <Ionicons name={muted ? 'volume-mute-outline' : 'restaurant-outline'} size={16} color={colors.successText} />
        <Text variant="smallStrong" color={colors.successText} numberOfLines={1} style={{ flexShrink: 1 }}>
          {t('ops.FloorAnnouncer.ready_to_serve_tables', { tables: tables.join(', ') })}
        </Text>
        {needsTap ? (
          <Button title={t('ops.KitchenScreen.tap_to_turn_on_voice')} size="sm" icon="mic-outline"
            onPress={() => { setTapped(true); sayNow(VOICE_ON_LINE); }} />
        ) : muted ? (
          <Button title={t('ops.FloorAnnouncer.unmute')} size="sm" variant="outline" icon="volume-high-outline" onPress={() => mute(Date.now(), 0)} />
        ) : (
          <Button title={t('ops.FloorAnnouncer.mute_5_min')} size="sm" variant="outline" icon="volume-mute-outline"
            onPress={() => { mute(Date.now()); hush(); }} testID="floor-announcer-mute" />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', top: 8, left: 0, right: 0, alignItems: 'center', zIndex: 50 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, maxWidth: '92%' },
});
