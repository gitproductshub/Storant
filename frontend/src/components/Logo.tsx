import React from 'react';
import { Image, View } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { Text } from './ui/Text';
import { brand } from '@/config/brand';

/** Storant mark: the brand app icon (assets/brand, never modified). */
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <Image
      source={require('../../assets/brand/storant-light-192.png')}
      style={{ width: size, height: size, borderRadius: size * 0.22 }}
      accessibilityLabel={brand.name}
    />
  );
}

export function Logo({ size = 30, inverse = false }: { size?: number; inverse?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <LogoMark size={size} />
      <Text variant="h2" color={inverse ? colors.sidebarText : colors.text} style={{ fontSize: size * 0.7, lineHeight: size * 0.9 }}>{brand.name}</Text>
    </View>
  );
}
