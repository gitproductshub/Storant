/**
 * Sign in. Built for shift change at a busy counter: the people who signed in on this device are one tap away
 * (email filled, cursor in the password), the last email is pre-filled, Enter signs in. The demo-account picker is
 * development-only and sits below the form so it never pushes the real fields down.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Link, router } from 'expo-router';
import { AuthLayout } from '@/components/AuthLayout';
import { ServerField } from '@/components/ServerField';
import { DemoAccountPicker } from '@/features/auth/DemoAccountPicker';
import { demoLoginsEnabled } from '@/features/auth/demoAccounts';
import { recentLoginInitials, useRecentLogins, type RecentLogin } from '@/features/auth/recentLogins';
import { Button, Input, Text } from '@/components/ui';
import { useAuth } from '@/store/auth';
import { errorMessage } from '@/api/client';
import { useTheme } from '@/theme/ThemeProvider';
import { fonts } from '@/theme/tokens';
import { isIndianMobile, mobileError, normalizeMobileInput, startsLikePhone } from '@/lib/phone';
import { brand } from '@/config/brand';
import { t } from '@/i18n';

export default function LoginScreen() {
  const { colors, radius } = useTheme();
  const login = useAuth((s) => s.login);
  /** Set when the server ended the session (signed out by Storant / another device, or the session expired) */
  const signOutReason = useAuth((s) => s.signOutReason);
  const recent = useRecentLogins((s) => s.recent);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const passwordRef = useRef<TextInput>(null);
  const prefilled = useRef(false);
  /**
   * "Email or phone" turns into a phone field (fixed +91, digits only, stops at 10) as soon as the first character typed is a
   * digit or +; a letter keeps it an email field. Clearing the field starts over.
   */
  const [phoneMode, setPhoneMode] = useState(false);
  const [phoneDone, setPhoneDone] = useState(false);
  const isPhoneIdentifier = (v: string) => /^\d+$/.test(v);
  const setIdentifier = (v: string) => {
    setEmail(v);
    setPhoneMode(isPhoneIdentifier(v));
    setPhoneDone(false);
  };
  const onIdentifierChange = (text: string) => {
    if (!text) { setIdentifier(''); return; }
    if (phoneMode || startsLikePhone(text)) {
      setPhoneMode(true);
      setEmail(normalizeMobileInput(text));
      return;
    }
    setEmail(text);
  };
  const phoneError = phoneMode ? mobileError(email, { final: phoneDone }) : null;

  // Last person on this device: email (or mobile) filled in, straight to the password
  useEffect(() => {
    if (prefilled.current || !recent.length) return;
    prefilled.current = true;
    if (!email) setIdentifier(recent[0]!.email);
    setTimeout(() => passwordRef.current?.focus(), 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recent]);

  const pick = (r: RecentLogin) => {
    setIdentifier(r.email);
    setPassword('');
    setError(null);
    setTimeout(() => passwordRef.current?.focus(), 0);
  };

  const submit = async () => {
    // A mobile number must be a valid Indian one before it goes to the server (which checks the same rule)
    if (phoneMode && !isIndianMobile(email)) { setPhoneDone(true); return; }
    if (!email.trim() || !password) {
      setError(email.trim() ? t('routes.login.enter_your_password') : t('routes.login.enter_your_email_or_phone_number_and'));
      if (email.trim()) passwordRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password);
      const s = useAuth.getState().session;
      useRecentLogins.getState().remember({ email: email.trim(), name: s?.fullName ?? null, business: s?.businessName ?? null });
      router.replace('/');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <View style={{ gap: 6 }}>
        <Text variant="h1">{t('routes.login.welcome_back')}</Text>
        <Text tone="muted">{recent.length ? t('routes.login.tap_your_name_then_enter_your_password') : t('routes.login.sign_in_to_your_business')}</Text>
      </View>
      {signOutReason ? (
        <View accessibilityRole="alert" style={{ flexDirection: 'row', gap: 10, backgroundColor: colors.warningSoft, padding: 12, borderRadius: radius.md }}>
          <Ionicons name="information-circle" size={18} color={colors.warningText} style={{ marginTop: 1 }} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="smallStrong" color={colors.warningText}>{signOutReason.title}</Text>
            <Text variant="small">{signOutReason.message}</Text>
          </View>
        </View>
      ) : null}

      {recent.length ? (
        <View style={{ gap: 6 }} accessibilityRole="list" accessibilityLabel={t('routes.login.recent_on_this_device')}>
          <Text variant="smallStrong" tone="muted">{t('routes.login.recent_on_this_device')}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {recent.map((r) => {
              const selected = r.email.toLowerCase() === email.trim().toLowerCase();
              return (
                <View key={r.email} style={[{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: radius.pill,
                  borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? colors.primarySoft : colors.surface, maxWidth: '100%' }]}>
                  <Pressable onPress={() => pick(r)} accessibilityRole="button" accessibilityLabel={t('routes.login.sign_in_as_v', { v: r.name ?? r.email })}
                    style={[{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 6, paddingRight: 4, minHeight: 44, flexShrink: 1 },
                      Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}>
                    <View style={{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: selected ? colors.primary : colors.surfaceSunken }}>
                      <Text variant="caption" color={selected ? colors.primaryText : colors.textMuted}>{recentLoginInitials(r)}</Text>
                    </View>
                    <View style={{ flexShrink: 1, minWidth: 0 }}>
                      <Text variant="smallStrong" numberOfLines={1}>{r.name ?? r.email}</Text>
                      {r.name ? <Text variant="caption" tone="subtle" numberOfLines={1}>{r.email}</Text> : null}
                    </View>
                  </Pressable>
                  <Pressable onPress={() => useRecentLogins.getState().forget(r.email)} accessibilityRole="button" accessibilityLabel={t('routes.login.forget_email_on_this_device', { email: r.email })}
                    hitSlop={6} style={[{ width: 34, height: 44, alignItems: 'center', justifyContent: 'center' }, Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}>
                    <Ionicons name="close" size={14} color={colors.textSubtle} />
                  </Pressable>
                </View>
              );
            })}
          </View>
        </View>
      ) : null}

      <Input label={t('routes.login.email_or_phone')} value={email} onChangeText={onIdentifierChange} autoCapitalize="none" autoCorrect={false} autoComplete="username"
        keyboardType={phoneMode ? 'number-pad' : 'email-address'} inputMode={phoneMode ? 'numeric' : 'email'}
        icon={phoneMode ? undefined : 'person-outline'} prefix={phoneMode ? '+91' : undefined} error={phoneError}
        onBlur={() => { if (phoneMode) setPhoneDone(true); }} testID="login-identifier"
        returnKeyType="next" onSubmitEditing={() => passwordRef.current?.focus()} textContentType="username" />
      <Input ref={passwordRef} label={t('common.password')} value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password"
        icon="lock-closed-outline" returnKeyType="go" onSubmitEditing={submit} textContentType="password" />
      {error ? (
        <View accessibilityRole="alert" style={{ backgroundColor: colors.dangerSoft, padding: 12, borderRadius: radius.md }}>
          <Text variant="small" tone="danger">{error}</Text>
        </View>
      ) : null}
      <Button title={t('routes.login.sign_in')} size="lg" onPress={submit} loading={busy} full shortcut="Enter" />
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, flexWrap: 'wrap' }}>
        <Text tone="muted">{t('routes.login.new_to_brand', { brand: brand.name })}</Text>
        <Link href="/signup"><Text tone="primary" variant="bodyStrong">{t('routes.login.create_a_free_account')}</Text></Link>
      </View>
      <PrivacyPill />
      {demoLoginsEnabled() ? <DemoAccountPicker disabled={busy} onPick={(e, p) => { setIdentifier(e); setPassword(p); setError(null); }} /> : null}
      <ServerField />
    </AuthLayout>
  );
}

/**
 * The privacy policy, easy to find before signing in (store rules) and never worded as consent: one pill on one line —
 * shield, muted "How we handle your data", a thin divider, bold "Privacy policy". When that doesn't fit (small phones,
 * Hindi / Gujarati), the caption is dropped instead of wrapping.
 */
function PrivacyPill() {
  const { colors, radius } = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const [boxWidth, setBoxWidth] = useState(0);
  const [fullWidth, setFullWidth] = useState(0);
  const [hovered, setHovered] = useState(false);
  // The full pill's natural width is measured from a hidden copy that never wraps (web); it fits or the caption goes.
  // Native has no max-content sizing, so there the window width decides.
  const room = boxWidth || windowWidth - 32;
  const compact = Platform.OS === 'web' ? fullWidth === 0 || fullWidth > room : windowWidth < 430;

  const pill = StyleSheet.flatten([styles.pill, {
    borderRadius: radius.pill, borderColor: colors.primary,
    backgroundColor: hovered ? colors.surfaceSunken : colors.primarySoft,
  }]);
  const content = (full: boolean) => (
    <>
      <Ionicons name="shield-checkmark-outline" size={18} color={colors.primarySoftText} />
      {full ? (
        <>
          <Text variant="small" tone="muted" numberOfLines={1}>{t('routes.login.how_we_handle_your_data')}</Text>
          <View style={[styles.divider, { backgroundColor: colors.primary }]} />
        </>
      ) : null}
      <Text variant="bodyStrong" color={colors.primarySoftText} numberOfLines={1} style={{ fontFamily: fonts.semibold }}>{t('common.privacy_policy')}</Text>
    </>
  );

  return (
    <View style={styles.pillBox} onLayout={(e) => setBoxWidth(Math.floor(e.nativeEvent.layout.width))}>
      {/* One element, styled directly: Link asChild merges styles and drops a style function, which left this unstyled on web */}
      <Pressable accessibilityRole="link" accessibilityLabel={t('routes.login.open_the_privacy_policy')} testID="login-privacy"
        onPress={() => router.push('/privacy')} onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
        style={[pill, Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}>
        {content(!compact)}
      </Pressable>
      {Platform.OS === 'web' ? (
        // Invisible measuring copy of the full pill (never wraps, never focusable)
        <View pointerEvents="none" aria-hidden importantForAccessibility="no-hide-descendants" accessibilityElementsHidden
          onLayout={(e) => setFullWidth(Math.ceil(e.nativeEvent.layout.width))}
          style={[pill, styles.measure, { width: 'max-content' } as any]}>
          {content(true)}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  pillBox: { alignItems: 'center', alignSelf: 'stretch' },
  pill: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', alignSelf: 'center', flexWrap: 'nowrap',
    gap: 10, minHeight: 44, paddingHorizontal: 18, borderWidth: 1,
  },
  divider: { width: 1, height: 16, opacity: 0.4 },
  measure: { position: 'absolute', top: 0, left: 0, opacity: 0 },
});
