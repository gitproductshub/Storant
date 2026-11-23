import React, { useState } from 'react';
import { Platform, View } from 'react-native';
import { router, type Href } from 'expo-router';
import { authApi } from '@/api/endpoints';
import { ApiError, errorMessage } from '@/api/client';
import { Badge, Button, Card, Input, ListRow, Segmented, Sheet, Text, confirm, toast } from '@/components/ui';
import { ServerField } from '@/components/ServerField';
import { useApi } from '@/hooks/useApi';
import { useAuth } from '@/store/auth';
import { useData } from '@/store/data';
import { useOutbox } from '@/store/outbox';
import { usePrefs } from '@/store/prefs';
import { syncNow } from '@/lib/sync';
import { endSession } from '@/lib/signOut';
import { DevicesSection } from '@/features/subscription/DevicesSection';
import { useTheme } from '@/theme/ThemeProvider';
import { SettingsFrame } from './SettingsFrame';
import { Callout, FieldRow, FormSection } from './components';
import { ROLE_LABEL } from './sections';
import { validatePassword } from './validation';
import { VoiceAlertsSection } from './VoiceAlertsSection';
import { brand } from '@/config/brand';
import { LanguageSegmented } from '@/i18n/LanguageSwitcher';
import { t } from '@/i18n';

function useUnsynced() {
  const tenantId = useAuth((s) => s.session?.tenantId);
  const queue = useOutbox((s) => s.queue);
  const mine = queue.filter((q) => q.tenantId === tenantId);
  return { pending: mine.filter((q) => !q.failed).length, failed: mine.filter((q) => q.failed).length, total: mine.length };
}

export default function AccountScreen() {
  const { colors } = useTheme();
  const session = useAuth((s) => s.session);
  const theme = usePrefs((s) => s.theme);
  const setPrefs = usePrefs((s) => s.set);
  const businessName = useData((s) => s.settings?.business_name) ?? session?.businessName ?? '';
  const me = useApi(() => authApi.me() as Promise<{ phone: string | null; full_name: string | null; email: string }>, [], { refetchOnFocus: false });
  const unsynced = useUnsynced();
  const [syncing, setSyncing] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [devicesKey, setDevicesKey] = useState(0);

  const name = me.data?.full_name || session?.fullName || 'Your account';
  const email = me.data?.email || session?.email || '';
  const role = session?.role ?? null;

  const sync = async () => {
    setSyncing(true);
    try {
      await syncNow();
      const left = useOutbox.getState().queue.filter((q) => q.tenantId === session?.tenantId && !q.failed).length;
      if (left) toast.warning(t('settings.AccountScreen.left_bill_v_still_waiting_check_the', { left, v: left === 1 ? '' : 's' }));
      else toast.success(t('settings.AccountScreen.everything_is_synced'));
    } finally {
      setSyncing(false);
    }
  };

  const signOut = async () => {
    const ok = await confirm({
      title: t('settings.AccountScreen.sign_out'),
      message: unsynced.total
        ? t('settings.AccountScreen.total_bill_v_not_reached_the_server_yet', { total: unsynced.total, v: unsynced.total === 1 ? t('settings.AccountScreen.has') : t('settings.AccountScreen.s_have') })
        : t('settings.AccountScreen.you_will_need_your_email_and_password_to'),
      confirmLabel: t('common.sign_out'),
      danger: unsynced.total > 0,
    });
    if (!ok) return;
    setSigningOut(true);
    try {
      await endSession();
      router.replace('/login' as Href);
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <SettingsFrame active="account" title={t('common.account')} subtitle={t('settings.AccountScreen.your_login_on_this_device')}>
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
          <Text variant="h2" color={colors.primarySoftText}>{name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') || '?'}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text variant="h3" numberOfLines={1}>{name}</Text>
          <Text tone="muted" numberOfLines={1} selectable>{email}</Text>
          {me.data?.phone ? <Text variant="small" tone="subtle">{me.data.phone}</Text> : null}
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          {role ? <Badge label={ROLE_LABEL[role]} tone={role === 'owner' ? 'accent' : 'primary'} /> : null}
          {businessName ? <Text variant="small" tone="muted" numberOfLines={1} style={{ maxWidth: 180 }}>{businessName}</Text> : null}
        </View>
      </Card>

      <ChangePassword onChanged={() => setDevicesKey((k) => k + 1)} />

      <DevicesSection refreshKey={devicesKey} />

      <FormSection title={t('settings.AccountScreen.language')} description={t('settings.AccountScreen.applies_to_this_device_receipts_and')}>
        <LanguageSegmented />
      </FormSection>

      <FormSection title={t('settings.AccountScreen.appearance')} description={t('settings.AccountScreen.applies_to_this_device')}>
        <Segmented value={theme} onChange={(v) => setPrefs({ theme: v })}
          options={[{ value: 'system', label: t('common.system'), icon: 'desktop-outline' }, { value: 'light', label: t('settings.AccountScreen.light'), icon: 'sunny-outline' }, { value: 'dark', label: t('settings.AccountScreen.dark'), icon: 'moon-outline' }]} />
        <Text variant="small" tone="subtle">{t('settings.AccountScreen.system_follows_your_device_s_light_dark')}</Text>
      </FormSection>

      <VoiceAlertsSection />

      {Platform.OS !== 'web' || process.env.EXPO_PUBLIC_ALLOW_SERVER_CHANGE ? (
        <FormSection title={t('settings.AccountScreen.server')} description={t('settings.AccountScreen.the_brand_server_this_app_talks_to_change', { brand: brand.name })}>
          <ServerField />
        </FormSection>
      ) : null}

      <FormSection title={t('common.sign_out')} description={t('settings.AccountScreen.signs_out_of_this_device_only')}>
        {unsynced.total ? (
          <Callout tone="warning" title={t('settings.AccountScreen.total_bill_v_not_synced_yet', { total: unsynced.total, v: unsynced.total === 1 ? '' : 's' })}
            action={<Button title={t('settings.AccountScreen.sync_now')} size="sm" icon="sync" variant="secondary" onPress={sync} loading={syncing} />}>
            {unsynced.failed
              ? t('settings.AccountScreen.failed_need_attention_in_orders_the_rest', { failed: unsynced.failed })
              : t('settings.AccountScreen.they_will_upload_when_the_internet_is')}
          </Callout>
        ) : null}
        <Button title={t('common.sign_out')} icon="log-out-outline" variant="secondary" onPress={signOut} loading={signingOut} style={{ alignSelf: 'flex-start' }} />
      </FormSection>

      <FormSection title={t('settings.AccountScreen.privacy')} description={t('settings.AccountScreen.what_brand_stores_and_why', { brand: brand.name })}>
        <ListRow title={t('common.privacy_policy')} subtitle={t('settings.AccountScreen.how_your_data_and_your_customers_data_is')} icon="shield-checkmark-outline"
          onPress={() => router.push('/privacy' as Href)} />
      </FormSection>

      <FormSection title={t('settings.AccountScreen.delete_account')} description={t('settings.AccountScreen.permanently_remove_your_login_this_cannot')}>
        <Text tone="muted">
          {role === 'owner'
            ? t('settings.AccountScreen.you_are_the_owner_so_deleting_your', { v: businessName || t('settings.AccountScreen.this_business') })
            : t('settings.AccountScreen.your_login_is_removed_the_business_and')}
        </Text>
        <Button title={t('settings.AccountScreen.delete_my_account')} icon="trash-outline" variant="dangerOutline" onPress={() => setDeleteOpen(true)} style={{ alignSelf: 'flex-start' }} />
      </FormSection>

      {deleteOpen ? <DeleteAccountSheet businessName={businessName} owner={role === 'owner'} unsynced={unsynced.total} onClose={() => setDeleteOpen(false)} /> : null}
    </SettingsFrame>
  );
}

function ChangePassword({ onChanged }: { onChanged?: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [currentError, setCurrentError] = useState<string | null>(null);

  const errors = {
    current: !current ? 'Enter your current password.' : undefined,
    next: validatePassword(next) ?? (next && next === current ? 'Choose a password different from the current one.' : undefined),
    again: !again ? 'Type the new password again.' : again !== next ? "Passwords don't match." : undefined,
  };
  const invalid = Object.values(errors).some(Boolean);

  const save = async () => {
    setSubmitted(true);
    setCurrentError(null);
    if (invalid) return;
    setSaving(true);
    try {
      await authApi.changePassword(current, next);
      toast.success(t('settings.AccountScreen.password_changed_other_devices_were'));
      onChanged?.();
      setCurrent('');
      setNext('');
      setAgain('');
      setSubmitted(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 400) setCurrentError(e.message);
      else toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const dirty = !!(current || next || again);
  return (
    <FormSection title={t('common.password')} description={t('settings.AccountScreen.use_at_least_8_characters_that_are_hard')}>
      <Input label={t('settings.AccountScreen.current_password')} value={current} onChangeText={(v) => { setCurrent(v); setCurrentError(null); }} secureTextEntry
        autoComplete="current-password" textContentType="password" error={currentError ?? (submitted ? errors.current : undefined)} />
      <FieldRow>
        <Input label={t('settings.AccountScreen.new_password')} value={next} onChangeText={setNext} secureTextEntry autoComplete="new-password" textContentType="newPassword"
          error={submitted || (next.length > 0 && next.length < 8 && again.length > 0) ? errors.next : undefined} maxLength={64}
          hint={next ? t('settings.AccountScreen.length_characters', { length: next.length }) : undefined} />
        <Input label={t('settings.AccountScreen.confirm_new_password')} value={again} onChangeText={setAgain} secureTextEntry autoComplete="new-password" textContentType="newPassword"
          error={submitted || (again.length >= next.length && again.length > 0) ? errors.again : undefined} maxLength={64} onSubmitEditing={save} />
      </FieldRow>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button title={t('settings.AccountScreen.change_password')} icon="key-outline" onPress={save} loading={saving} disabled={!dirty} />
        {dirty ? <Button title={t('common.clear')} variant="ghost" onPress={() => { setCurrent(''); setNext(''); setAgain(''); setSubmitted(false); setCurrentError(null); }} /> : null}
      </View>
    </FormSection>
  );
}

function DeleteAccountSheet({ businessName, owner, unsynced, onClose }: { businessName: string; owner: boolean; unsynced: number; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [typed, setTyped] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = password.length > 0 && typed.trim().toUpperCase() === 'DELETE';

  const remove = async () => {
    if (!ready) return;
    setDeleting(true);
    setError(null);
    try {
      const result = await authApi.deleteAccount(password);
      await useAuth.getState().logout();
      useData.getState().reset();
      toast.success(result?.business_closed ? t('settings.AccountScreen.your_account_was_deleted_and_the_business') : t('settings.AccountScreen.your_account_was_deleted'));
      router.replace('/login' as Href);
    } catch (e) {
      setError(e instanceof ApiError && e.status === 400 ? t('settings.AccountScreen.password_is_incorrect') : errorMessage(e));
      setDeleting(false);
    }
  };

  return (
    <Sheet visible onClose={deleting ? () => {} : onClose} dismissable={!deleting} title={t('settings.AccountScreen.delete_your_account')} width={520}
      footer={
        <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <Button title={t('common.cancel')} variant="secondary" onPress={onClose} disabled={deleting} />
          <Button title={owner ? t('settings.AccountScreen.delete_account_and_close_business') : t('settings.AccountScreen.delete_my_account_2')} variant="danger" icon="trash-outline" onPress={remove} loading={deleting} disabled={!ready} />
        </View>
      }>
      {owner ? (
        <Callout tone="danger" title={t('settings.AccountScreen.this_closes_v', { v: businessName || t('settings.AccountScreen.your_business') })}>
          <View style={{ gap: 4 }}>
            <Text variant="small">{t('settings.AccountScreen.every_staff_login_stops_working_and_your')}</Text>
            <Text variant="small">{t('settings.AccountScreen.customer_names_phone_numbers_emails_and')}</Text>
            <Text variant="small">{t('settings.AccountScreen.your_name_email_and_phone_are_erased')}</Text>
            <Text variant="small">{t('settings.AccountScreen.invoices_and_sales_records_are_kept')}</Text>
          </View>
        </Callout>
      ) : (
        <Callout tone="warning" title={t('settings.AccountScreen.your_login_will_be_removed')}>
          <View style={{ gap: 4 }}>
            <Text variant="small">{t('settings.AccountScreen.you_can_t_sign_in_to')} {businessName || t('settings.AccountScreen.this_business')} {t('settings.AccountScreen.again')}</Text>
            <Text variant="small">{t('settings.AccountScreen.your_name_email_and_phone_are_erased')}</Text>
            <Text variant="small">{t('settings.AccountScreen.bills_you_created_stay_in_the_business_s')}</Text>
          </View>
        </Callout>
      )}
      {unsynced ? (
        <Callout tone="warning">{t('settings.AccountScreen.unsynced_bill_v_not_been_synced_and_will', { unsynced, v: unsynced === 1 ? t('settings.AccountScreen.on_this_device_has') : t('settings.AccountScreen.s_on_this_device_have') })}</Callout>
      ) : null}
      <Input label={t('settings.AccountScreen.your_password')} value={password} onChangeText={(v) => { setPassword(v); setError(null); }} secureTextEntry autoComplete="current-password" error={error} />
      <Input label={t('common.type_delete_to_confirm')} value={typed} onChangeText={setTyped} autoCapitalize="characters" autoCorrect={false} placeholder={t('common.delete')}
        hint={t('settings.AccountScreen.this_can_t_be_undone')} onSubmitEditing={remove} />
      <Text variant="small" tone="subtle">{t('settings.AccountScreen.read_more_in_the_privacy_policy_or_ask')}</Text>
    </Sheet>
  );
}
