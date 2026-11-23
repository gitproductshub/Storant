import React, { useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Link, router } from 'expo-router';
import { AuthLayout } from '@/components/AuthLayout';
import { ServerField } from '@/components/ServerField';
import { Button, Input, Text } from '@/components/ui';
import { useAuth } from '@/store/auth';
import { errorMessage } from '@/api/client';
import { useTheme } from '@/theme/ThemeProvider';
import type { BusinessType } from '@/api/types';
import { isIndianMobile, mobileError, normalizeMobileInput } from '@/lib/phone';
import { t as tr } from '@/i18n';

const TYPES: { value: BusinessType; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: 'restaurant', get label() { return tr('common.restaurant'); }, icon: 'restaurant-outline' },
  { value: 'cafe', get label() { return tr('routes.signup.caf_qsr'); }, icon: 'cafe-outline' },
  { value: 'cloud_kitchen', get label() { return tr('common.cloud_kitchen'); }, icon: 'bicycle-outline' },
  { value: 'retail', get label() { return tr('routes.signup.retail_store'); }, icon: 'storefront-outline' },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SignupScreen() {
  const { colors, radius } = useTheme();
  const register = useAuth((s) => s.register);
  const [form, setForm] = useState({ vendor_name: '', owner_name: '', email: '', phone: '', password: '' });
  const [type, setType] = useState<BusinessType>('restaurant');
  const [agreed, setAgreed] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** The person left the mobile field: from now on "too short" shows too. */
  const [phoneDone, setPhoneDone] = useState(false);
  const set = (key: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [key]: v }));

  const validate = () => {
    const e: Record<string, string> = {};
    if (form.vendor_name.trim().length < 2) e.vendor_name = tr('routes.signup.enter_your_business_name');
    if (!EMAIL_RE.test(form.email.trim())) e.email = tr('routes.signup.enter_a_valid_email_address');
    if (!isIndianMobile(form.phone)) e.phone = tr('common.enter_valid_indian_mobile');
    if (form.password.length < 8) e.password = tr('routes.signup.use_at_least_8_characters');
    if (!agreed) e.agreed = tr('routes.signup.please_accept_the_privacy_policy_to');
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async () => {
    if (!validate()) return;
    setBusy(true);
    setServerError(null);
    try {
      await register({
        vendor_name: form.vendor_name.trim(), owner_name: form.owner_name.trim() || undefined, email: form.email.trim().toLowerCase(),
        phone: form.phone, password: form.password, business_type: type, // 10 digits (the server checks the same rule)
      });
      router.replace('/');
    } catch (e) {
      setServerError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <View style={{ gap: 6 }}>
        <Text variant="h1">{tr('routes.signup.create_your_business')}</Text>
        <Text tone="muted">{tr('routes.signup.free_to_start_set_up_your_menu_in_minutes')}</Text>
      </View>

      <View style={{ gap: 8 }}>
        <Text variant="smallStrong" tone="muted">{tr('routes.signup.what_do_you_run')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {TYPES.map((t) => {
            const active = t.value === type;
            return (
              <Pressable key={t.value} onPress={() => setType(t.value)} accessibilityRole="radio" accessibilityState={{ checked: active }}
                style={[{ flexBasis: '47%', flexGrow: 1, flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderWidth: 1.5, borderRadius: radius.md,
                  borderColor: active ? colors.primary : colors.border, backgroundColor: active ? colors.primarySoft : colors.surface },
                  Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}>
                <Ionicons name={t.icon} size={18} color={active ? colors.primary : colors.textMuted} />
                <Text variant="smallStrong" color={active ? colors.primarySoftText : colors.text}>{t.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <Input label={tr('common.business_name')} required value={form.vendor_name} onChangeText={set('vendor_name')} error={errors.vendor_name} placeholder={tr('routes.signup.e_g_sharma_dhaba')} icon="business-outline" />
      <Input label={tr('routes.signup.your_name')} value={form.owner_name} onChangeText={set('owner_name')} placeholder={tr('routes.signup.owner_name')} icon="person-outline" autoComplete="name" />
      <Input label={tr('common.email')} required value={form.email} onChangeText={set('email')} error={errors.email} keyboardType="email-address" autoCapitalize="none" autoComplete="email" icon="mail-outline" />
      {/* Indian mobile only: +91 fixed, digits only, stops at 10; pasted +91 / 0 forms are cleaned up (lib/phone.ts) */}
      <Input label={tr('common.mobile_number')} required value={form.phone}
        onChangeText={(v) => { setForm((f) => ({ ...f, phone: normalizeMobileInput(v) })); setErrors(({ phone: _drop, ...rest }) => rest); }}
        onBlur={() => setPhoneDone(true)} error={errors.phone ?? mobileError(form.phone, { final: phoneDone })}
        keyboardType="number-pad" inputMode="numeric" autoComplete="tel" prefix="+91" placeholder="9876543210" testID="signup-mobile" />
      <Input label={tr('common.password')} required value={form.password} onChangeText={set('password')} error={errors.password} secureTextEntry autoComplete="new-password" hint={tr('routes.signup.at_least_8_characters')} icon="lock-closed-outline" />

      <Pressable onPress={() => setAgreed((a) => !a)} accessibilityRole="checkbox" accessibilityState={{ checked: agreed }} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
        <Ionicons name={agreed ? 'checkbox' : 'square-outline'} size={22} color={agreed ? colors.primary : colors.textSubtle} />
        <Text variant="small" tone="muted" style={{ flex: 1 }}>
          {tr('routes.signup.i_agree_to_the')} <Link href="/privacy"><Text variant="small" tone="primary">{tr('routes.signup.privacy_policy')}</Text></Link> {tr('routes.signup.and_confirm_i_m_allowed_to_store_my')}
        </Text>
      </Pressable>
      {errors.agreed ? <Text variant="small" tone="danger">{errors.agreed}</Text> : null}
      {serverError ? (
        <View style={{ backgroundColor: colors.dangerSoft, padding: 12, borderRadius: 10 }}>
          <Text variant="small" tone="danger">{serverError}</Text>
        </View>
      ) : null}

      <Button title={tr('routes.signup.create_account')} size="lg" onPress={submit} loading={busy} full disabled={!isIndianMobile(form.phone)}
        disabledReason={tr('common.enter_valid_indian_mobile')} />
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6 }}>
        <Text tone="muted">{tr('routes.signup.already_have_an_account')}</Text>
        <Link href="/login"><Text tone="primary" variant="bodyStrong">{tr('routes.signup.sign_in')}</Text></Link>
      </View>
      <ServerField />
    </AuthLayout>
  );
}
