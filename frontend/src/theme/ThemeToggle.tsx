import React from 'react';
import { PillMenu } from '@/components/ui/PillMenu';
import { usePrefs } from '@/store/prefs';
import { t } from '@/i18n';

type Mode = 'system' | 'light' | 'dark';
const ICON = { system: 'desktop-outline', light: 'sunny-outline', dark: 'moon-outline' } as const;
const label = (m: Mode) => (m === 'system' ? t('common.system') : m === 'light' ? t('settings.AccountScreen.light') : t('settings.AccountScreen.dark'));

/**
 * Theme control for every screen: a pill showing the current mode's icon that opens a menu of System, Light and Dark
 * (with icons and a check on the current one). The same choice also lives in Settings → Account.
 */
export function ThemeToggle({ tone, compact }: { tone?: 'default' | 'sidebar'; compact?: boolean }) {
  const theme = usePrefs((s) => s.theme);
  const setPrefs = usePrefs((s) => s.set);
  const modes: Mode[] = ['system', 'light', 'dark'];
  return (
    <PillMenu
      icon={ICON[theme]}
      tone={tone}
      compact={compact}
      width={180}
      tooltip={`${t('settings.AccountScreen.appearance')}: ${label(theme)}`}
      menuTitle={t('settings.AccountScreen.appearance')}
      accessibilityLabel={`${t('settings.AccountScreen.appearance')}: ${label(theme)}`}
      items={modes.map((m) => ({ key: m, label: label(m), icon: ICON[m], selected: m === theme, onPress: () => setPrefs({ theme: m }) }))}
    />
  );
}
