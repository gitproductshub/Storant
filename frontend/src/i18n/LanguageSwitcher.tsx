import React from 'react';
import { PillMenu } from '@/components/ui/PillMenu';
import { Segmented } from '@/components/ui/Surface';
import { usePrefs } from '@/store/prefs';
import { LANGUAGES, t, type Language } from './index';

/**
 * The one language control for every screen: a pill showing the current language (EN / हिंदी / ગુજરાતી) that opens a
 * menu of English, हिन्दी and ગુજરાતી, each in its own script, with a check on the current one.
 */
export function LanguageMenu({ tone, compact }: { tone?: 'default' | 'sidebar'; compact?: boolean }) {
  const language = usePrefs((s) => s.language);
  const setPrefs = usePrefs((s) => s.set);
  const current = LANGUAGES.find((l) => l.code === language) ?? LANGUAGES[0]!;
  return (
    <PillMenu
      icon="globe-outline"
      label={current.short}
      tone={tone}
      compact={compact}
      tooltip={t('common.language')}
      accessibilityLabel={`${t('common.language')}: ${current.native}`}
      items={LANGUAGES.map((l) => ({ key: l.code, label: l.native, selected: l.code === language, onPress: () => setPrefs({ language: l.code }) }))}
    />
  );
}

/** Full picker for Settings. */
export function LanguageSegmented() {
  const language = usePrefs((s) => s.language);
  const setPrefs = usePrefs((s) => s.set);
  return (
    <Segmented<Language>
      value={language}
      onChange={(v) => setPrefs({ language: v })}
      options={LANGUAGES.map((l) => ({ value: l.code, label: l.native }))}
    />
  );
}
