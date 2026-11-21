import React, { useRef, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '@/theme/ThemeProvider';
import { Button, Card, Input, Text } from '@/components/ui';
import { authApi } from '@/api/endpoints';
import { errorMessage } from '@/api/client';
import type { AuthResponse, Role } from '@/api/types';
import { useAuth } from '@/store/auth';
import { PublicPage, Notice } from './PublicPage';
import { Rich } from './RichText';
import { deleteAccountWithToken } from './accountApi';
import { brand } from '@/config/brand';
import { t } from '@/i18n';

const SUPPORT_EMAIL = '[[support@your-domain]]';
const ROLE_LABEL: Record<Role, string> = { get owner() { return t('common.owner'); }, get manager() { return t('public.DeleteAccountScreen.manager'); }, get cashier() { return t('public.DeleteAccountScreen.cashier'); }, get waiter() { return t('common.waiter'); }, get kitchen() { return t('public.DeleteAccountScreen.kitchen_staff'); } };

type Step = 'signin' | 'confirm' | 'done';

export default function DeleteAccountScreen() {
  const { colors, radius } = useTheme();
  const [step, setStep] = useState<Step>('signin');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ identifier?: string; password?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);
  const [account, setAccount] = useState<AuthResponse | null>(null);
  const [typed, setTyped] = useState('');
  const [result, setResult] = useState<{ businessClosed: boolean } | null>(null);
  const passwordRef = useRef<TextInput>(null);

  const signIn = async () => {
    const next: typeof errors = {};
    if (identifier.trim().length < 3) next.identifier = t('public.DeleteAccountScreen.enter_the_email_or_phone_number_you_sign');
    if (!password) next.password = t('public.DeleteAccountScreen.enter_your_password');
    setErrors(next);
    if (next.identifier || next.password) return;
    setBusy(true);
    try {
      const auth = await authApi.login(identifier.trim(), password);
      setAccount(auth);
      setTyped('');
      setStep('confirm');
    } catch (e) {
      setErrors({ form: errorMessage(e, 'Could not sign in. Check your details and try again.') });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!account || typed.trim().toUpperCase() !== 'DELETE') return;
    setBusy(true);
    setErrors({});
    try {
      const r = await deleteAccountWithToken(account.access_token, password);
      // If this browser is signed in to the same account, sign it out too.
      const session = useAuth.getState().session;
      if (session && (session.userId === account.user?.id || (session.tenantId === account.tenant_id && r.business_closed))) {
        await useAuth.getState().logout();
      }
      setPassword('');
      setAccount(null);
      setResult({ businessClosed: !!r.business_closed });
      setStep('done');
    } catch (e) {
      setErrors({ form: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    setAccount(null);
    setPassword('');
    setTyped('');
    setErrors({});
    setStep('signin');
  };

  const isOwner = account?.role === 'owner';
  const business = account?.business_name || 'your business';

  return (
    <PublicPage title={t('public.DeleteAccountScreen.delete_your_account')} maxWidth={640}>
      <View style={{ gap: 8 }}>
        <Text variant="caption" tone="primary" style={{ textTransform: 'uppercase' }}>{t('common.account')}</Text>
        <Text variant="display" accessibilityRole="header">{t('public.DeleteAccountScreen.delete_your_brand_account', { brand: brand.name })}</Text>
        <Text tone="muted" style={{ lineHeight: 24 }}>
          {t('public.DeleteAccountScreen.you_can_delete_your_account_at_any_time')}
        </Text>
      </View>

      <Card style={{ marginTop: 20, gap: 12 }}>
        <View style={styles.row}>
          <View style={[styles.icon, { backgroundColor: colors.primarySoft }]}>
            <Ionicons name="phone-portrait-outline" size={18} color={colors.primary} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="bodyStrong">{t('public.DeleteAccountScreen.in_the_app')}</Text>
            <Text tone="muted">{t('common.open')} <Text variant="bodyStrong">{t('public.DeleteAccountScreen.settings_account_delete_account')}</Text>{t('public.DeleteAccountScreen.enter_your_password_and_confirm')}</Text>
          </View>
        </View>
        <View style={[styles.row, { borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: 12 }]}>
          <View style={[styles.icon, { backgroundColor: colors.primarySoft }]}>
            <Ionicons name="globe-outline" size={18} color={colors.primary} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="bodyStrong">{t('public.DeleteAccountScreen.on_this_page')}</Text>
            <Text tone="muted">{t('public.DeleteAccountScreen.sign_in_below_review_what_will_be_deleted')}</Text>
          </View>
        </View>
      </Card>

      {step === 'signin' ? (
        <Card style={{ marginTop: 16, gap: 14 }}>
          <View style={{ gap: 2 }}>
            <Text variant="h2">{t('public.DeleteAccountScreen.step_1_confirm_it_s_you')}</Text>
            <Text variant="small" tone="muted">{t('public.DeleteAccountScreen.we_ll_show_you_exactly_what_happens')}</Text>
          </View>
          <Input label={t('public.DeleteAccountScreen.email_or_phone')} value={identifier} onChangeText={(v) => { setIdentifier(v); setErrors((e) => ({ ...e, identifier: undefined, form: undefined })); }}
            autoCapitalize="none" autoCorrect={false} autoComplete="username" keyboardType="email-address" icon="person-outline"
            error={errors.identifier} returnKeyType="next" onSubmitEditing={() => passwordRef.current?.focus()} textContentType="username" />
          <Input ref={passwordRef} label={t('common.password')} value={password} onChangeText={(v) => { setPassword(v); setErrors((e) => ({ ...e, password: undefined, form: undefined })); }}
            secureTextEntry autoComplete="current-password" icon="lock-closed-outline" error={errors.password} returnKeyType="go"
            onSubmitEditing={signIn} textContentType="password" />
          {errors.form ? <Notice tone="danger">{errors.form}</Notice> : null}
          <Button title={t('common.continue')} size="lg" onPress={signIn} loading={busy} full iconRight="arrow-forward" />
        </Card>
      ) : null}

      {step === 'confirm' && account ? (
        <Card style={{ marginTop: 16, gap: 16, borderColor: colors.danger }}>
          <View style={{ gap: 2 }}>
            <Text variant="h2">{t('public.DeleteAccountScreen.step_2_review_and_confirm')}</Text>
            <Text variant="small" tone="muted">{t('public.DeleteAccountScreen.this_cannot_be_undone')}</Text>
          </View>
          <View style={[styles.accountBox, { backgroundColor: colors.surfaceSunken, borderRadius: radius.md }]}>
            <Ionicons name="person-circle-outline" size={32} color={colors.textMuted} />
            <View style={{ flex: 1 }}>
              <Text variant="bodyStrong" numberOfLines={1}>{account.user?.full_name || account.user?.email || identifier}</Text>
              <Text variant="small" tone="muted" numberOfLines={1}>
                {account.role ? (ROLE_LABEL[account.role] ?? account.role) : (account.platform_role === "support" ? t('public.DeleteAccountScreen.brand_support', { brand: brand.name }) : t('public.DeleteAccountScreen.brand_admin', { brand: brand.name }))}{account.business_name ? ` · ${account.business_name}` : ''}
              </Text>
            </View>
          </View>

          {isOwner ? (
            <Notice tone="danger" title={t('public.DeleteAccountScreen.this_closes_business', { business })}>
              <View style={{ gap: 6 }}>
                <Text variant="small" color={colors.dangerText}>{t('public.DeleteAccountScreen.your_login_and_every_staff_login_for_this')}</Text>
                <Text variant="small" color={colors.dangerText}>{t('public.DeleteAccountScreen.your_name_email_and_phone_number_are')}</Text>
                <Text variant="small" color={colors.dangerText}>{t('public.DeleteAccountScreen.invoices_and_sales_records_are_kept')}</Text>
                <Text variant="small" color={colors.dangerText}>{t('public.DeleteAccountScreen.your_online_store_and_qr_ordering_pages')}</Text>
              </View>
            </Notice>
          ) : (
            <Notice tone="warning" title={t('public.DeleteAccountScreen.only_your_login_is_deleted')}>
              <View style={{ gap: 6 }}>
                <Text variant="small" color={colors.warningText}>{t('public.DeleteAccountScreen.your_name_email_phone_number_and_password')}</Text>
                <Text variant="small" color={colors.warningText}>{t('public.DeleteAccountScreen.business_and_its_records_are_not_affected', { business })}</Text>
              </View>
            </Notice>
          )}

          <Input label={t('common.type_delete_to_confirm')} value={typed} onChangeText={setTyped} autoCapitalize="characters" autoCorrect={false}
            placeholder={t('common.delete')} onSubmitEditing={remove} />
          {errors.form ? <Notice tone="danger">{errors.form}</Notice> : null}
          <View style={styles.actions}>
            <Button title={t('common.cancel')} variant="secondary" onPress={cancel} disabled={busy} style={{ flex: 1 }} />
            <Button title={isOwner ? t('public.DeleteAccountScreen.close_business_delete') : t('public.DeleteAccountScreen.delete_my_account')} variant="danger" icon="trash-outline" onPress={remove}
              loading={busy} disabled={typed.trim().toUpperCase() !== 'DELETE'} style={{ flex: 1.4 }} />
          </View>
        </Card>
      ) : null}

      {step === 'done' ? (
        <Card style={{ marginTop: 16, gap: 14, alignItems: 'center', paddingVertical: 32 }}>
          <View style={[styles.doneIcon, { backgroundColor: colors.successSoft }]}>
            <Ionicons name="checkmark" size={30} color={colors.success} />
          </View>
          <Text variant="h2" align="center">{t('public.DeleteAccountScreen.your_account_has_been_deleted')}</Text>
          <Text tone="muted" align="center" style={{ maxWidth: 440 }}>
            {result?.businessClosed
              ? t('public.DeleteAccountScreen.the_business_has_been_closed_and_all_its')
              : t('public.DeleteAccountScreen.your_login_has_been_removed_the_business')}
          </Text>
          <Button title={t('common.done')} variant="secondary" onPress={() => router.replace('/')} />
        </Card>
      ) : null}

      <View style={{ marginTop: 24, gap: 12 }}>
        <Text variant="h3">{t('public.DeleteAccountScreen.can_t_sign_in')}</Text>
        <Rich>{t('public.DeleteAccountScreen.email_support_email_from_the_email', { SUPPORT_EMAIL })}</Rich>
        <Rich>{t('public.DeleteAccountScreen.read_more_about_what_we_keep_and_why_in')}</Rich>
      </View>
    </PublicPage>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  accountBox: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  actions: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  doneIcon: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center' },
});
