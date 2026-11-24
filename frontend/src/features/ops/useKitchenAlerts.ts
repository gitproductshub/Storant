/**
 * New-order alerts for the kitchen, shared by the kitchen display and the kitchen's Home, so a kitchen that stays on
 * Home never misses an order: one beep and one spoken Hindi line per refresh ("नया ऑर्डर आया है। टेबल 5।"), never for
 * tickets that were already there when the screen opened. Voice is per device (Settings → Account → Voice alerts).
 */
import { useEffect, useRef, useState } from 'react';
import type { FloorTicket } from '@/api/floor';
import { playAlert } from '@/hooks/live';
import { say, sayNow, useWakeLock, voiceAvailable, voiceNeedsTap } from '@/lib/voice';
import { VOICE_ON_LINE, newKotLine } from '@/lib/voiceLines';
import { useBadges } from '@/store/badges';
import { useVoicePrefs } from '@/store/voicePrefs';
import { freshIds } from './floorLogic';

/** Tickets already announced on this device: Home and the kitchen display both stay mounted, each speaks a ticket once. */
const announced = new Set<string>();
const ANNOUNCED_MAX = 2000;

function markAnnounced(ids: string[]): void {
  ids.forEach((id) => announced.add(id));
  if (announced.size > ANNOUNCED_MAX) [...announced].slice(0, announced.size - ANNOUNCED_MAX).forEach((id) => announced.delete(id));
}

/** Beep and speak for tickets that are new since the last refresh. `onFresh` gets their ids (the display makes them glow). */
export function useNewTicketAlerts(data: FloorTicket[] | null, opts: { sound: boolean; onFresh?: (ids: string[], at: number) => void }): void {
  const seen = useRef<Set<string> | null>(null);
  const kitchenVoice = useVoicePrefs((s) => s.kitchenVoice);
  const kitchenItems = useVoicePrefs((s) => s.kitchenItems);
  const onFresh = useRef(opts.onFresh);
  onFresh.current = opts.onFresh;
  const { sound } = opts;

  useEffect(() => {
    if (!data) return;
    const ids = data.filter((t) => t.status === 'pending').map((t) => t.id);
    const fresh = freshIds(seen.current, ids).filter((id) => !announced.has(id));
    if (fresh.length) {
      markAnnounced(fresh);
      onFresh.current?.(fresh, Date.now());
      if (sound) playAlert('kitchen');
      if (kitchenVoice) {
        const fresher = new Set(fresh);
        say(newKotLine(data.filter((t) => fresher.has(t.id)).map((t) => ({
          table_label: t.table_label, bill_label: t.bill_label, token_no: t.token_no, channel: t.channel, items: t.items,
        })), { items: kitchenItems }));
      }
      void useBadges.getState().refresh();
    }
    seen.current = new Set([...(seen.current ?? []), ...data.map((t) => t.id)]);
  }, [data, sound, kitchenVoice, kitchenItems]);
}

/**
 * The kitchen voice switch on this device: keeps the screen awake while voice is on, and knows whether the browser still
 * needs one tap before it may speak ("Tap to turn on voice").
 */
export function useKitchenVoice() {
  const enabled = useVoicePrefs((s) => s.kitchenVoice);
  const setVoicePrefs = useVoicePrefs((s) => s.set);
  const canSpeak = voiceAvailable();
  const [tapped, setTapped] = useState(false);
  useWakeLock(canSpeak && enabled); // the screen stays on while it listens for orders
  const turnOn = () => { setTapped(true); sayNow(VOICE_ON_LINE); };
  return {
    canSpeak,
    enabled,
    needsTap: canSpeak && enabled && !tapped && voiceNeedsTap(),
    turnOn,
    toggle: () => { setVoicePrefs({ kitchenVoice: !enabled }); if (!enabled) turnOn(); },
  };
}
