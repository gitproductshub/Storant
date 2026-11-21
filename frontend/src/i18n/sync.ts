import { usePrefs } from '@/store/prefs';
import { loadScriptFonts } from '@/theme/scriptFonts';
import { isLanguage, setLanguage } from './index';

/** Keep i18n (and the script font) in step with the saved language preference. Import once from the root layout. */
function apply(lang: unknown) {
  if (!isLanguage(lang)) return;
  setLanguage(lang);
  void loadScriptFonts(lang);
}

apply(usePrefs.getState().language);
usePrefs.persist.onFinishHydration((s) => apply(s.language));
usePrefs.subscribe((s, prev) => { if (s.language !== prev.language) apply(s.language); });
