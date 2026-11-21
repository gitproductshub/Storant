/**
 * Storant design tokens. Every screen reads colours, spacing, radii and type from here,
 * so the brand can be re-skinned by editing this one file.
 */
import { localizeFont } from './scriptFonts';
export const palette = {
  teal50: '#ECFDF9', teal100: '#CCFBEF', teal500: '#14B8A6', teal600: '#0D9488', teal700: '#0F766E', teal800: '#115E59', teal900: '#134E4A',
  amber50: '#FFFBEB', amber100: '#FEF3C7', amber300: '#FCD34D', amber400: '#FBBF24', amber500: '#F59E0B', amber600: '#D97706', amber700: '#B45309',
  red50: '#FEF2F2', red100: '#FEE2E2', red500: '#EF4444', red600: '#DC2626', red700: '#B91C1C',
  green50: '#F0FDF4', green100: '#DCFCE7', green500: '#22C55E', green600: '#16A34A', green700: '#15803D',
  blue50: '#EFF6FF', blue100: '#DBEAFE', blue500: '#3B82F6', blue600: '#2563EB', blue700: '#1D4ED8',
  violet50: '#F5F3FF', violet100: '#EDE9FE', violet300: '#C4B5FD', violet500: '#8B5CF6', violet600: '#7C3AED', violet700: '#6D28D9',
  purple50: '#F5EFFD', purple100: '#EBDDFA', purple200: '#D8C2F5', purple300: '#C0A0EC', purple400: '#A57DE0', purple500: '#8B5CD6',
  purple600: '#6E36B0', purple700: '#51218A', purple800: '#3E1870', purple900: '#241443', purple950: '#130D26',
  amberInk: '#1F1300', white: '#FFFFFF',
  slate0: '#FFFFFF', slate25: '#FBFCFD', slate50: '#F6F8FA', slate100: '#EEF1F5', slate200: '#E2E7EE', slate300: '#CBD3DE',
  slate400: '#94A1B3', slate500: '#64748B', slate600: '#475569', slate700: '#334155', slate800: '#1E293B', slate850: '#172131',
  slate900: '#0F172A', slate950: '#0A101C',
};

export interface ThemeColors {
  background: string; surface: string; surfaceAlt: string; surfaceSunken: string; overlay: string;
  border: string; borderStrong: string; divider: string;
  text: string; textMuted: string; textSubtle: string; textInverse: string;
  primary: string; primaryHover: string; primaryText: string; primarySoft: string; primarySoftText: string;
  accent: string; accentSoft: string; accentText: string;
  success: string; successSoft: string; successText: string;
  warning: string; warningSoft: string; warningText: string;
  danger: string; dangerSoft: string; dangerText: string;
  info: string; infoSoft: string; infoText: string;
  veg: string; nonVeg: string;
  sidebar: string; sidebarText: string; sidebarMuted: string; sidebarActive: string; sidebarActiveText: string;
  /** Hover fill and divider line on the (always dark) sidebar and auth brand panel. */
  sidebarHover: string; sidebarLine: string;
  /** Edge between the sidebar / auth brand panel and the page (light theme only; dark has none). */
  sidebarBorder: string;
  /** Always-dark backdrop for camera previews and photo captions, with the text colour used on it (both themes). */
  mediaBg: string; onMedia: string;
  focus: string; shadow: string;
  /** Text/icon colour on solid success, danger and accent fills. */
  onSuccess: string; onDanger: string; onAccent: string;
  /** Kitchen / KOT actions: solid amber with dark, readable text (never confused with Pay = green). */
  kitchen: string; kitchenHover: string; onKitchen: string; kitchenSoft: string; kitchenText: string;
  /** "Waiting for confirmation" (UPI claim, online order awaiting accept): purple. */
  waiting: string; waitingSoft: string; waitingText: string;
  /** Disabled controls: clearly reduced contrast, never mistaken for an enabled button. */
  disabledBg: string; disabledText: string; disabledBorder: string;
  /** Skeleton placeholder blocks and selected-row tint. */
  skeleton: string; selectedRow: string;
  /** Neutral status/pill fill that stays visible on `surface` in both themes. */
  neutralSoft: string;
  /** Count bubble on buttons (e.g. "Send 2"). */
  bubble: string; onBubble: string;
}

/** Light theme: background #FBF9FF, primary #51218A (see src/config/brand.ts). */
export const lightColors: ThemeColors = {
  background: '#FBF9FF', surface: palette.white, surfaceAlt: '#F8F4FE', surfaceSunken: '#F1EBFA',
  overlay: 'rgba(27, 18, 48, 0.45)',
  border: '#E6DDF3', borderStrong: '#CFC0E6', divider: '#EFE8F8',
  text: '#1B1230', textMuted: '#5A4D73', textSubtle: '#76698F', textInverse: palette.white,
  primary: palette.purple700, primaryHover: palette.purple800, primaryText: palette.white, primarySoft: palette.purple50, primarySoftText: palette.purple800,
  accent: palette.amber500, accentSoft: palette.amber50, accentText: palette.amber700,
  success: palette.green600, successSoft: palette.green50, successText: palette.green700,
  warning: palette.amber600, warningSoft: palette.amber50, warningText: palette.amber700,
  danger: palette.red600, dangerSoft: palette.red50, dangerText: palette.red700,
  info: palette.blue600, infoSoft: palette.blue50, infoText: palette.blue700,
  veg: palette.green600, nonVeg: palette.red600,
  sidebar: palette.white, sidebarText: '#1B1230', sidebarMuted: '#5A4D73', sidebarActive: palette.purple100, sidebarActiveText: palette.purple700,
  sidebarHover: 'rgba(81, 33, 138, 0.06)', sidebarLine: '#E6DDF3', sidebarBorder: '#E6DDF3',
  mediaBg: palette.purple950, onMedia: palette.white,
  focus: palette.purple500, shadow: '#1B1230',
  onSuccess: palette.white, onDanger: palette.white, onAccent: palette.amberInk,
  kitchen: palette.amber500, kitchenHover: palette.amber600, onKitchen: palette.amberInk, kitchenSoft: palette.amber100, kitchenText: palette.amber700,
  waiting: palette.violet600, waitingSoft: palette.violet50, waitingText: palette.violet700,
  disabledBg: '#F1EBFA', disabledText: '#9A8DB3', disabledBorder: '#E6DDF3',
  skeleton: '#EFE8F8', selectedRow: palette.purple50, neutralSoft: '#EFE8F8',
  bubble: palette.red600, onBubble: palette.white,
};

/** Dark theme: background #130D26, surface #241443 (see src/config/brand.ts). */
export const darkColors: ThemeColors = {
  background: '#130D26', surface: '#241443', surfaceAlt: '#1C1136', surfaceSunken: '#0E091D',
  overlay: 'rgba(5, 2, 14, 0.66)',
  border: '#3A2862', borderStrong: '#4E3A80', divider: '#2E1F52',
  text: '#F4EFFB', textMuted: '#BFB2D8', textSubtle: '#9283B3', textInverse: '#130D26',
  primary: '#8B5CD6', primaryHover: '#9D75E0', primaryText: palette.white, primarySoft: 'rgba(165, 125, 224, 0.18)', primarySoftText: '#D8C2F5',
  accent: palette.amber500, accentSoft: 'rgba(245, 158, 11, 0.14)', accentText: '#FCD34D',
  success: palette.green500, successSoft: 'rgba(34, 197, 94, 0.14)', successText: '#86EFAC',
  warning: palette.amber500, warningSoft: 'rgba(245, 158, 11, 0.14)', warningText: '#FCD34D',
  danger: palette.red500, dangerSoft: 'rgba(239, 68, 68, 0.14)', dangerText: '#FCA5A5',
  info: palette.blue500, infoSoft: 'rgba(59, 130, 246, 0.14)', infoText: '#93C5FD',
  veg: palette.green500, nonVeg: palette.red500,
  sidebar: '#0E091D', sidebarText: '#EDE6F8', sidebarMuted: '#8F80AE', sidebarActive: 'rgba(165, 125, 224, 0.22)', sidebarActiveText: '#D8C2F5',
  sidebarHover: 'rgba(255, 255, 255, 0.06)', sidebarLine: 'rgba(255, 255, 255, 0.09)', sidebarBorder: 'transparent',
  mediaBg: '#0E091D', onMedia: palette.white,
  focus: palette.purple400, shadow: '#000000',
  onSuccess: '#052E16', onDanger: palette.white, onAccent: palette.amberInk,
  kitchen: palette.amber500, kitchenHover: palette.amber400, onKitchen: palette.amberInk, kitchenSoft: 'rgba(245, 158, 11, 0.16)', kitchenText: palette.amber300,
  waiting: palette.violet500, waitingSoft: 'rgba(139, 92, 246, 0.16)', waitingText: palette.violet300,
  disabledBg: '#2A1B4A', disabledText: '#7B6C9C', disabledBorder: '#3A2862',
  skeleton: '#2E1F52', selectedRow: 'rgba(165, 125, 224, 0.14)', neutralSoft: '#33245C',
  bubble: palette.red500, onBubble: palette.white,
};

export const space = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32, huge: 48 } as const;
export const radius = { sm: 6, md: 10, lg: 14, xl: 18, xxl: 24, pill: 999 } as const;

/** Raw Inter family names (the type scale below stores these; `Text` swaps in the script font for Hindi/Gujarati). */
const inter = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  extrabold: 'Inter_800ExtraBold',
} as const;

/** Font families for inputs, charts etc. Getters, so they follow the active language (Noto Sans Devanagari / Gujarati). */
export const fonts = {
  get regular() { return localizeFont(inter.regular) as string; },
  get medium() { return localizeFont(inter.medium) as string; },
  get semibold() { return localizeFont(inter.semibold) as string; },
  get bold() { return localizeFont(inter.bold) as string; },
  get extrabold() { return localizeFont(inter.extrabold) as string; },
};

export const type = {
  display: { fontSize: 30, lineHeight: 38, fontFamily: inter.bold, letterSpacing: -0.6 },
  h1: { fontSize: 24, lineHeight: 32, fontFamily: inter.bold, letterSpacing: -0.4 },
  h2: { fontSize: 19, lineHeight: 26, fontFamily: inter.semibold, letterSpacing: -0.2 },
  h3: { fontSize: 16, lineHeight: 22, fontFamily: inter.semibold },
  body: { fontSize: 15, lineHeight: 22, fontFamily: inter.regular },
  bodyStrong: { fontSize: 15, lineHeight: 22, fontFamily: inter.semibold },
  small: { fontSize: 13, lineHeight: 18, fontFamily: inter.regular },
  smallStrong: { fontSize: 13, lineHeight: 18, fontFamily: inter.semibold },
  caption: { fontSize: 11.5, lineHeight: 16, fontFamily: inter.medium, letterSpacing: 0.3 },
  money: { fontSize: 15, lineHeight: 22, fontFamily: inter.semibold, fontVariant: ['tabular-nums'] as ('tabular-nums')[] },
  moneyLarge: { fontSize: 28, lineHeight: 34, fontFamily: inter.bold, letterSpacing: -0.5, fontVariant: ['tabular-nums'] as ('tabular-nums')[] },
} as const;

export type TypeVariant = keyof typeof type;

/** Layout breakpoints (dp). Tablet and desktop get a sidebar and split panes. */
export const breakpoints = { tablet: 768, desktop: 1100 } as const;

/** Minimum touch target for busy counters (WCAG + Material recommend ≥44–48). */
export const touch = { min: 44, comfortable: 52 } as const;

/** Fixed list row heights (§2.6): compact for desktop tables, comfortable for touch. */
export const rowHeight = { compact: 44, comfortable: 56 } as const;
