import React from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme/ThemeProvider';
import { ActionMenu, type ActionMenuItem } from './ActionMenu';
import { Text } from './Text';

type IconName = keyof typeof Ionicons.glyphMap;

/**
 * Shared header control for "pick one of a few": a bordered pill with a subtle fill, an icon, an optional
 * label and a small chevron; it opens a menu with a check on the current choice. Used for Language and Theme
 * on every screen. `tone="sidebar"` uses the sidebar tokens (dark or light, matching the active theme).
 */
export function PillMenu({ icon, label, accessibilityLabel, tooltip, items, tone = 'default', compact, menuTitle, width = 200 }: {
  icon: IconName;
  /** Visible text next to the icon (omitted when `compact`). */
  label?: string;
  accessibilityLabel: string;
  tooltip: string;
  items: ActionMenuItem[];
  tone?: 'default' | 'sidebar';
  compact?: boolean;
  menuTitle?: string;
  width?: number;
}) {
  const { colors } = useTheme();
  const sidebar = tone === 'sidebar';
  const fg = sidebar ? colors.sidebarText : colors.text;
  const muted = sidebar ? colors.sidebarMuted : colors.textMuted;
  return (
    <ActionMenu
      title={menuTitle ?? tooltip}
      align={sidebar ? 'start' : 'end'}
      width={width}
      items={items}
      trigger={(open) => (
        <Pressable
          onPress={open}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          {...(Platform.OS === 'web' ? ({ title: tooltip } as object) : {})}
          hitSlop={4}
          style={({ pressed, hovered }: any) => [
            styles.pill,
            {
              backgroundColor: pressed || hovered ? (sidebar ? colors.sidebarLine : colors.surfaceSunken) : (sidebar ? colors.sidebarHover : colors.surfaceAlt),
              borderColor: sidebar ? colors.sidebarLine : colors.borderStrong,
            },
            Platform.OS === 'web' && ({ cursor: 'pointer' } as any),
          ]}
        >
          <Ionicons name={icon} size={17} color={fg} />
          {!compact && label ? <Text variant="smallStrong" color={fg} numberOfLines={1} style={styles.label}>{label}</Text> : null}
          <Ionicons name="chevron-down" size={13} color={muted} />
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  pill: { minHeight: 36, borderRadius: 18, borderWidth: 1, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 6 },
  label: { flexShrink: 1 },
});
