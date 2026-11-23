/**
 * Voice alerts, remembered per device (no business-wide setting): the kitchen hears new orders, floor staff hear
 * "टेबल 5 का ऑर्डर तैयार है" and reminders until the food is served. See lib/voice.ts.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { persistStorage } from '@/lib/storage';

/** Seconds between "not served yet" reminders; 0 = off. */
export type ReminderSeconds = 0 | 30 | 60 | 120;
export const REMINDER_CHOICES: ReminderSeconds[] = [30, 60, 120, 0];
export const MUTE_MINUTES = 5;

export interface VoicePrefs {
  /** Kitchen screen: say new orders out loud. */
  kitchenVoice: boolean;
  /** Kitchen screen: also read the items (off by default: long at peak time). */
  kitchenItems: boolean;
  /** Floor staff: say when a dine-in order is ready, and remind until it is served. */
  readyVoice: boolean;
  reminderSeconds: ReminderSeconds;
  /** Only tables assigned to me (otherwise every table). */
  onlyMyTables: boolean;
  /** A chosen voice (`voiceURI`); null = the best Hindi (female) voice on this device. */
  voiceUri: string | null;
  /** Epoch ms until which this device stays quiet ("Mute 5 min"); 0 = not muted. */
  mutedUntil: number;
}

interface VoicePrefsState extends VoicePrefs {
  set: (patch: Partial<VoicePrefs>) => void;
  /** Quiet for MUTE_MINUTES from `now` (or unmute with minutes = 0). */
  mute: (now: number, minutes?: number) => void;
}

export const VOICE_DEFAULTS: VoicePrefs = {
  kitchenVoice: true, kitchenItems: false, readyVoice: true, reminderSeconds: 60, onlyMyTables: false, voiceUri: null, mutedUntil: 0,
};

export const useVoicePrefs = create<VoicePrefsState>()(
  persist(
    (set) => ({
      ...VOICE_DEFAULTS,
      set: (patch) => set(patch),
      mute: (now, minutes = MUTE_MINUTES) => set({ mutedUntil: minutes > 0 ? now + minutes * 60_000 : 0 }),
    }),
    {
      name: 'tallyko.voice',
      storage: persistStorage,
      version: 1,
      partialize: (s) => ({
        kitchenVoice: s.kitchenVoice, kitchenItems: s.kitchenItems, readyVoice: s.readyVoice, reminderSeconds: s.reminderSeconds,
        onlyMyTables: s.onlyMyTables, voiceUri: s.voiceUri, mutedUntil: s.mutedUntil,
      }),
    },
  ),
);

export function isMuted(mutedUntil: number, now: number): boolean {
  return mutedUntil > now;
}
