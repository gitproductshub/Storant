import * as Font from 'expo-font';
import { currentLanguage, type Language } from '@/i18n';

/**
 * Noto Sans Devanagari (Hindi) and Noto Sans Gujarati ship inside the app bundle (npm packages that
 * contain the .ttf files), so nothing is fetched from the internet. They load in the background:
 * the UI never waits for them, and until they are ready the system font is used.
 */
type Weight = '400Regular' | '500Medium' | '600SemiBold' | '700Bold' | '800ExtraBold';

const INTER_TO_WEIGHT: Record<string, Weight> = {
  Inter_400Regular: '400Regular', Inter_500Medium: '500Medium', Inter_600SemiBold: '600SemiBold',
  Inter_700Bold: '700Bold', Inter_800ExtraBold: '800ExtraBold',
};

const PREFIX: Record<Exclude<Language, 'en'>, string> = { hi: 'NotoSansDevanagari', gu: 'NotoSansGujarati' };

/* eslint-disable @typescript-eslint/no-require-imports */
const FILES: Record<Exclude<Language, 'en'>, Record<Weight, number>> = {
  hi: {
    '400Regular': require('@expo-google-fonts/noto-sans-devanagari/400Regular/NotoSansDevanagari_400Regular.ttf'),
    '500Medium': require('@expo-google-fonts/noto-sans-devanagari/500Medium/NotoSansDevanagari_500Medium.ttf'),
    '600SemiBold': require('@expo-google-fonts/noto-sans-devanagari/600SemiBold/NotoSansDevanagari_600SemiBold.ttf'),
    '700Bold': require('@expo-google-fonts/noto-sans-devanagari/700Bold/NotoSansDevanagari_700Bold.ttf'),
    '800ExtraBold': require('@expo-google-fonts/noto-sans-devanagari/800ExtraBold/NotoSansDevanagari_800ExtraBold.ttf'),
  },
  gu: {
    '400Regular': require('@expo-google-fonts/noto-sans-gujarati/400Regular/NotoSansGujarati_400Regular.ttf'),
    '500Medium': require('@expo-google-fonts/noto-sans-gujarati/500Medium/NotoSansGujarati_500Medium.ttf'),
    '600SemiBold': require('@expo-google-fonts/noto-sans-gujarati/600SemiBold/NotoSansGujarati_600SemiBold.ttf'),
    '700Bold': require('@expo-google-fonts/noto-sans-gujarati/700Bold/NotoSansGujarati_700Bold.ttf'),
    '800ExtraBold': require('@expo-google-fonts/noto-sans-gujarati/800ExtraBold/NotoSansGujarati_800ExtraBold.ttf'),
  },
};
/* eslint-enable @typescript-eslint/no-require-imports */

const loaded = new Set<string>();

function familyMap(lang: Exclude<Language, 'en'>): Record<string, number> {
  const out: Record<string, number> = {};
  (Object.keys(FILES[lang]) as Weight[]).forEach((w) => { out[`${PREFIX[lang]}_${w}`] = FILES[lang][w]; });
  return out;
}

/** Start loading the script font for a language. Never throws and never blocks rendering. */
export function loadScriptFonts(lang: Language): Promise<void> {
  if (lang === 'en' || loaded.has(lang)) return Promise.resolve();
  return Font.loadAsync(familyMap(lang)).then(() => { loaded.add(lang); }).catch(() => { /* system font is used instead */ });
}

/** Map an Inter family name to the matching weight of the script font for the current language (identity for English). */
export function localizeFont(family: string | undefined): string | undefined {
  const lang = currentLanguage();
  if (lang === 'en' || !family) return family;
  const w = INTER_TO_WEIGHT[family];
  return w ? `${PREFIX[lang]}_${w}` : family;
}
