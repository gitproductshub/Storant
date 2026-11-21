import React from 'react';
import { Text as RNText, TextProps as RNTextProps, TextStyle } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { type as typeScale, type TypeVariant } from '@/theme/tokens';
import type { ThemeColors } from '@/theme/tokens';
import { localizeFont } from '@/theme/scriptFonts';
import { currentLanguage } from '@/i18n';

export type TextTone = 'default' | 'muted' | 'subtle' | 'primary' | 'success' | 'warning' | 'danger' | 'inverse' | 'accent' | 'info';

export interface TextProps extends RNTextProps {
  variant?: TypeVariant;
  tone?: TextTone;
  align?: TextStyle['textAlign'];
  color?: string;
}

export function toneColor(colors: ThemeColors, tone: TextTone): string {
  switch (tone) {
    case 'muted': return colors.textMuted;
    case 'subtle': return colors.textSubtle;
    case 'primary': return colors.primary;
    case 'success': return colors.successText;
    case 'warning': return colors.warningText;
    case 'danger': return colors.dangerText;
    case 'inverse': return colors.textInverse;
    case 'accent': return colors.accentText;
    case 'info': return colors.infoText;
    default: return colors.text;
  }
}

/** Devanagari and Gujarati stack marks above and below the line, so they need ~18% more line height than Latin. */
function scriptStyle(family: string, lineHeight: number): TextStyle {
  const font = localizeFont(family);
  return currentLanguage() === 'en' ? { fontFamily: font } : { fontFamily: font, lineHeight: Math.round(lineHeight * 1.18) };
}

export function Text({ variant = 'body', tone = 'default', align, color, style, ...rest }: TextProps) {
  const { colors } = useTheme();
  return (
    <RNText
      {...rest}
      style={[typeScale[variant] as TextStyle, scriptStyle(typeScale[variant].fontFamily, typeScale[variant].lineHeight), { color: color ?? toneColor(colors, tone) }, align ? { textAlign: align } : null, style]}
    />
  );
}
