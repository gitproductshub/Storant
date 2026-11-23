/**
 * Voice alerts engine. Speaks Hindi (Devanagari) lines from lib/voiceLines.ts, one after another, never the same line twice
 * in the queue, and stays quiet while this device is muted ("Mute 5 min", store/voicePrefs.ts).
 *
 * Engines: the web/PWA uses the browser's own speechSynthesis (free, no package). Native apps have no engine yet
 * (`noEngine`); a native one (e.g. expo-speech) can be added later by implementing VoiceEngine and returning it from
 * `defaultEngine()` — nothing else changes.
 *
 * Voice: the best Hindi voice on the device, preferring female ones (Google हिन्दी on Android, Microsoft Kalpana / Swara on
 * Windows, Lekha on Apple), unless the person picked one in Settings → Account → Voice alerts.
 */
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { isMuted, useVoicePrefs } from '@/store/voicePrefs';

export interface VoiceInfo { uri: string; name: string; lang: string; local: boolean }

export interface VoiceEngine {
  readonly kind: 'web' | 'none';
  available(): boolean;
  voices(): VoiceInfo[];
  /** Resolves when the line has been said (or could not be). */
  speak(text: string, voiceUri: string | null, lang: string): Promise<void>;
  cancel(): void;
  /** Voices often load after start-up (Chrome): call back when the list changes. Returns an unsubscribe. */
  onVoicesChanged(cb: () => void): () => void;
}

export const noEngine: VoiceEngine = {
  kind: 'none',
  available: () => false,
  voices: () => [],
  speak: async () => {},
  cancel: () => {},
  onVoicesChanged: () => () => {},
};

/** Browser speechSynthesis. Exported with its globals as parameters so it can be tested. */
export function createWebEngine(synth: SpeechSynthesis | undefined, Utterance: typeof SpeechSynthesisUtterance | undefined): VoiceEngine {
  if (!synth || !Utterance) return noEngine;
  const list = () => synth.getVoices().map((v) => ({ uri: v.voiceURI, name: v.name, lang: v.lang, local: v.localService }));
  return {
    kind: 'web',
    available: () => true,
    voices: list,
    speak: (text, voiceUri, lang) => new Promise<void>((resolve) => {
      try {
        const u = new Utterance(text);
        u.lang = lang;
        const voice = voiceUri ? synth.getVoices().find((v) => v.voiceURI === voiceUri) : undefined;
        if (voice) u.voice = voice;
        u.rate = 0.95; // a little slower: clearer over kitchen noise
        u.volume = 1;
        let done = false;
        const finish = () => { if (!done) { done = true; resolve(); } };
        u.onend = finish;
        u.onerror = finish;
        // Some browsers never fire onend; never let the queue get stuck
        setTimeout(finish, Math.min(30_000, 4_000 + text.length * 120));
        synth.speak(u);
      } catch {
        resolve();
      }
    }),
    cancel: () => { try { synth.cancel(); } catch { /* ignore */ } },
    onVoicesChanged: (cb) => {
      const handler = () => cb();
      synth.addEventListener?.('voiceschanged', handler);
      return () => synth.removeEventListener?.('voiceschanged', handler);
    },
  };
}

export function defaultEngine(): VoiceEngine {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return noEngine;
  const w = window as unknown as { speechSynthesis?: SpeechSynthesis; SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance };
  return createWebEngine(w.speechSynthesis, w.SpeechSynthesisUtterance);
}

const FEMALE_HINTS = ['female', 'kalpana', 'lekha', 'swara', 'heera', 'google हिन्दी', 'google hindi', 'hi-in-x-hia', 'hi-in-x-hic', 'hi-in-x-hie'];
const MALE_HINTS = ['male', 'hemant', 'madhur', 'prabhat', 'rishi', 'hi-in-x-hid'];

function score(v: VoiceInfo): number {
  const name = `${v.name} ${v.uri}`.toLowerCase();
  const lang = v.lang.toLowerCase().replace('_', '-');
  if (!lang.startsWith('hi')) return -1;
  let s = 100 + (lang === 'hi-in' ? 10 : 0);
  if (FEMALE_HINTS.some((h) => name.includes(h))) s += 20;
  if (MALE_HINTS.some((h) => name.includes(h)) && !name.includes('female')) s -= 30;
  if (name.includes('google') || name.includes('natural') || name.includes('online')) s += 5;
  return s;
}

/** The voice to use: the one chosen (if still on the device), else the best Hindi voice, preferring female; null = none. */
export function pickVoice(voices: VoiceInfo[], chosenUri: string | null): VoiceInfo | null {
  if (chosenUri) {
    const chosen = voices.find((v) => v.uri === chosenUri);
    if (chosen) return chosen;
  }
  const hindi = voices.map((v) => ({ v, s: score(v) })).filter((x) => x.s >= 0).sort((a, b) => b.s - a.s);
  return hindi[0]?.v ?? null;
}

/** Hindi voices on this device, best first (for the picker in settings). */
export function hindiVoices(voices: VoiceInfo[]): VoiceInfo[] {
  return voices.filter((v) => score(v) >= 0).sort((a, b) => score(b) - score(a));
}

// ---------------------------------------------------------------------------------------------- queue

/** One line after another; a line already waiting is not queued again. Exported (with an engine) for tests. */
export function createSpeaker(getEngine: () => VoiceEngine, getVoiceUri: () => string | null) {
  const queue: string[] = [];
  let speaking = false;
  const drain = async () => {
    if (speaking) return;
    speaking = true;
    try {
      while (queue.length) {
        const engine = getEngine();
        const next = queue.shift()!;
        if (!engine.available()) continue;
        const voice = pickVoice(engine.voices(), getVoiceUri());
        await engine.speak(next, voice?.uri ?? null, voice?.lang || 'hi-IN');
      }
    } finally {
      speaking = false;
    }
  };
  return {
    say(text: string): void {
      const line = text.trim();
      if (!line || queue.includes(line)) return;
      queue.push(line);
      void drain();
    },
    clear(): void {
      queue.length = 0;
      getEngine().cancel();
    },
    pending: () => [...queue],
  };
}

let engine: VoiceEngine | null = null;
const engineNow = () => (engine ??= defaultEngine());
const speaker = createSpeaker(engineNow, () => useVoicePrefs.getState().voiceUri);

/** Can this device speak at all? (False on the native apps for now, and in browsers without speechSynthesis.) */
export function voiceAvailable(): boolean {
  return engineNow().available();
}

export function deviceVoices(): VoiceInfo[] {
  return engineNow().voices();
}

export function onVoicesChanged(cb: () => void): () => void {
  return engineNow().onVoicesChanged(cb);
}

/** Say a line unless this device is muted. */
export function say(text: string, now = Date.now()): void {
  if (isMuted(useVoicePrefs.getState().mutedUntil, now)) return;
  speaker.say(text);
}

/** Say a line even while muted (the "Test voice" button). */
export function sayNow(text: string): void {
  speaker.say(text);
}

/** Stop talking and drop what is waiting (e.g. "Mute 5 min"). */
export function hush(): void {
  speaker.clear();
}

/**
 * Browsers only speak after the person has tapped the page once. True while that tap is still needed, so screens can show
 * "Tap to turn on voice". Browsers without `navigator.userActivation` are assumed ready.
 */
export function voiceNeedsTap(): boolean {
  if (Platform.OS !== 'web' || typeof navigator === 'undefined') return false;
  const ua = (navigator as unknown as { userActivation?: { hasBeenActive: boolean } }).userActivation;
  return !!ua && !ua.hasBeenActive;
}

/**
 * Keeps the screen awake while `enabled` (Screen Wake Lock API, where the browser supports it) so a kitchen tablet or a
 * waiter's phone keeps hearing alerts. Taken again when the page becomes visible; released when turned off.
 */
export function useWakeLock(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || Platform.OS !== 'web' || typeof navigator === 'undefined' || typeof document === 'undefined') return undefined;
    const api = (navigator as unknown as { wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void>; addEventListener?: (e: string, cb: () => void) => void }> } }).wakeLock;
    if (!api?.request) return undefined;
    let lock: { release: () => Promise<void> } | null = null;
    let stopped = false;
    const acquire = async () => {
      if (stopped || lock || document.visibilityState !== 'visible') return;
      try {
        const l = await api.request('screen');
        if (stopped) { void l.release().catch(() => {}); return; }
        lock = l;
        l.addEventListener?.('release', () => { lock = null; });
      } catch {
        /* not allowed right now (battery saver, no tap yet): tried again when the page is shown */
      }
    };
    const onVisible = () => { if (document.visibilityState === 'visible') void acquire(); };
    void acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release().catch(() => {});
      lock = null;
    };
  }, [enabled]);
}
