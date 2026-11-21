import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { Platform } from 'react-native';
import en from './locales/en.json';
import hi from './locales/hi.json';
import gu from './locales/gu.json';

export type Language = 'en' | 'hi' | 'gu';

export const LANGUAGES: { code: Language; label: string; native: string; short: string }[] = [
  { code: 'en', label: 'English', native: 'English', short: 'EN' },
  { code: 'hi', label: 'Hindi', native: 'हिन्दी', short: 'हिंदी' },
  { code: 'gu', label: 'Gujarati', native: 'ગુજરાતી', short: 'ગુજરાતી' },
];

export function isLanguage(v: unknown): v is Language {
  return v === 'en' || v === 'hi' || v === 'gu';
}

/** Web: the saved choice is readable synchronously, so the very first render is already in the right language. */
function savedLanguageOnWeb(): Language {
  try {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const raw = window.localStorage.getItem('tallyko.prefs'); // key kept so existing choices survive the rebrand
      const lang = raw ? JSON.parse(raw)?.state?.language : null;
      if (isLanguage(lang)) return lang;
    }
  } catch { /* blocked storage: fall back to English */ }
  return 'en';
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, hi: { translation: hi }, gu: { translation: gu } },
  lng: savedLanguageOnWeb(),
  fallbackLng: 'en', // anything not translated yet shows in English instead of a raw key
  supportedLngs: ['en', 'hi', 'gu'],
  keySeparator: '.',
  nsSeparator: false,
  interpolation: { escapeValue: false },
  returnNull: false,
  initAsync: false,
});

/** Translate by key ("pos.save_bill"), with {{name}} values. Always returns a string. */
export function t(key: string, values?: Record<string, unknown>): string {
  return String(i18n.t(key, values as never));
}

export function currentLanguage(): Language {
  const l = i18n.language;
  return isLanguage(l) ? l : 'en';
}

export function setLanguage(lang: Language): void {
  if (i18n.language !== lang) void i18n.changeLanguage(lang);
}

/** Locale for dates and numbers. Indian digit grouping everywhere; Latin digits so prices stay easy to scan at the till. */
export function currentLocale(): string {
  switch (currentLanguage()) {
    case 'hi': return 'hi-IN-u-nu-latn';
    case 'gu': return 'gu-IN-u-nu-latn';
    default: return 'en-IN';
  }
}

export default i18n;
