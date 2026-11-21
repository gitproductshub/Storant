/**
 * Onboard a business for a customer who bought Storant, then show the owner's temporary password once (copy / share).
 * Also exports the one-time credentials sheet used after "Reset owner password".
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { errorMessage } from '@/api/client';
import { platformApi, type BusinessCreated, type PlanInfo } from '@/api/platform';
import type { BusinessType } from '@/api/types';
import { Button, Card, Input, Sheet, Text, toast } from '@/components/ui';
import { useApi } from '@/hooks/useApi';
import { Callout, ChoiceChips, FieldRow, SettingSwitch, copyText, shareText } from '@/features/settings/components';
import { fieldErrorsFrom, validateEmail, validatePhone } from '@/features/settings/validation';
import { BUSINESS_TYPES, BUSINESS_TYPE_LABEL, goTo, useOnline } from './shared';
import { brand } from '@/config/brand';
import { t as tr, currentLocale } from '@/i18n';

export function OnboardBusinessSheet({ plans, onClose, onDone }: { plans: PlanInfo[]; onClose: () => void; onDone?: (created: BusinessCreated) => void }) {
  const online = useOnline();
  const activePlans = useMemo(() => plans.filter((p) => p.is_active), [plans]);
  const [businessName, setBusinessName] = useState('');
  const [businessType, setBusinessType] = useState<BusinessType>('restaurant');
  const [ownerName, setOwnerName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerPhone, setOwnerPhone] = useState('');
  const [planKey, setPlanKey] = useState<string>(activePlans.find((p) => p.key === 'standard')?.key ?? activePlans[0]?.key ?? 'pro');
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<(BusinessCreated & { name: string }) | null>(null);
  const settings = useApi(() => platformApi.settings(), [], { refetchOnFocus: false });
  const defaultDays = settings.data?.trial_days ?? null;
  /** '' = the platform default */
  const [demo, setDemo] = useState('');
  const [development, setDevelopment] = useState(false);
  const demoNum = demo.trim() === '' ? null : Number(demo.trim());

  // Plans may finish loading after the sheet opens: make sure a real plan is selected
  useEffect(() => {
    if (activePlans.length && !activePlans.some((p) => p.key === planKey)) {
      setPlanKey(activePlans.find((p) => p.key === 'standard')?.key ?? activePlans[0]!.key);
    }
  }, [activePlans, planKey]);

  const errors: Record<string, string | undefined> = {
    business_name: businessName.trim().length < 2 ? 'Enter the business name (at least 2 characters).' : undefined,
    owner_name: !ownerName.trim() ? "Enter the owner's name." : undefined,
    owner_email: validateEmail(ownerEmail, true),
    owner_phone: validatePhone(ownerPhone, true),
    demo_days: demoNum !== null && !(Number.isInteger(demoNum) && demoNum >= 0 && demoNum <= 365) ? '0–365 days.' : undefined,
  };
  const show = (k: string) => serverErrors[k] || (submitted ? errors[k] : undefined);
  const clear = (k: string) => setServerErrors((s) => ({ ...s, [k]: '' }));

  const submit = async () => {
    setSubmitted(true);
    setFormError(null);
    if (Object.values(errors).some(Boolean)) return;
    setSaving(true);
    try {
      const result = await platformApi.createBusiness({
        business_name: businessName.trim(), business_type: businessType, owner_name: ownerName.trim(),
        owner_email: ownerEmail.trim().toLowerCase(), owner_phone: ownerPhone.replace(/-/g, ' ').trim(), plan_key: planKey,
        demo_days: development ? undefined : demoNum, development,
      });
      toast.success(tr('admin.OnboardBusinessSheet.trim_is_on_brand', { trim: businessName.trim(), brand: brand.name }));
      setCreated({ ...result, name: businessName.trim() });
      onDone?.(result);
    } catch (e) {
      setServerErrors(fieldErrorsFrom(e));
      setFormError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  if (created) {
    return (
      <CredentialsSheet
        title={tr('admin.OnboardBusinessSheet.business_onboarded')}
        heading={tr('admin.OnboardBusinessSheet.name_is_ready', { name: created.name })}
        message={tr('admin.OnboardBusinessSheet.send_the_owner_these_sign_in_details')}
        email={created.owner_email}
        password={created.temporary_password}
        onClose={onClose}
        extraAction={<Button title={tr('common.open_business')} variant="secondary" icon="open-outline" onPress={() => { onClose(); goTo(`/admin/businesses/${created.id}`); }} />}
      />
    );
  }

  return (
    <Sheet
      visible
      onClose={onClose}
      title={tr('admin.OnboardBusinessSheet.onboard_a_business')}
      subtitle={tr('admin.OnboardBusinessSheet.creates_the_business_and_its_owner_login', { brand: brand.name })}
      width={640}
      footer={
        <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'flex-end' }}>
          <Button title={tr('common.cancel')} variant="secondary" onPress={onClose} disabled={saving} />
          <Button title={tr('admin.OnboardBusinessSheet.create_business')} icon="storefront-outline" onPress={submit} loading={saving} disabled={!online} />
        </View>
      }
    >
      {formError ? <Callout tone="danger">{formError}</Callout> : null}
      {!online ? <Callout tone="warning">{tr('admin.OnboardBusinessSheet.you_re_offline_connect_to_the_internet_to')}</Callout> : null}
      <Input label={tr('common.business_name')} required value={businessName} onChangeText={(v) => { setBusinessName(v); clear('vendor_name'); }}
        error={show('business_name') || serverErrors.vendor_name} maxLength={100} placeholder={tr('admin.OnboardBusinessSheet.e_g_sharma_sweets')} autoFocus />
      <View style={{ gap: 6 }}>
        <Text variant="smallStrong" tone="muted">{tr('admin.OnboardBusinessSheet.business_type')}</Text>
        <ChoiceChips value={businessType} onChange={setBusinessType} accessibilityLabel={tr('admin.OnboardBusinessSheet.business_type')}
          options={BUSINESS_TYPES.map((t) => ({ value: t, label: BUSINESS_TYPE_LABEL[t] ?? t }))} />
      </View>
      <FieldRow>
        <Input label={tr('admin.OnboardBusinessSheet.owner_name')} required value={ownerName} onChangeText={(v) => { setOwnerName(v); clear('owner_name'); }}
          error={show('owner_name')} maxLength={80} placeholder={tr('admin.OnboardBusinessSheet.e_g_rakesh_sharma')} />
        <Input label={tr('admin.OnboardBusinessSheet.owner_phone')} required value={ownerPhone} onChangeText={(v) => { setOwnerPhone(v); clear('owner_phone'); }}
          error={show('owner_phone')} keyboardType="phone-pad" maxLength={16} placeholder="98765 43210" />
      </FieldRow>
      <Input label={tr('admin.OnboardBusinessSheet.owner_email_used_to_sign_in')} required value={ownerEmail} onChangeText={(v) => { setOwnerEmail(v); clear('owner_email'); clear('email'); }}
        error={show('owner_email') || serverErrors.email} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} placeholder="owner@business.in" />
      <View style={{ gap: 6 }}>
        <Text variant="smallStrong" tone="muted">{tr('common.plan')}</Text>
        {activePlans.length ? (
          <ChoiceChips value={planKey} onChange={setPlanKey} accessibilityLabel={tr('common.plan')}
            options={activePlans.map((p) => ({ value: p.key, label: p.price_monthly ? tr('admin.OnboardBusinessSheet.name_tolocalestring_mo', { name: p.name, toLocaleString: p.price_monthly.toLocaleString(currentLocale()) }) : p.name }))} />
        ) : <Text variant="small" tone="subtle">{tr('admin.OnboardBusinessSheet.plans_are_loading_the_business_starts_on')}</Text>}
      </View>
      <View style={{ gap: 6 }}>
        <Text variant="smallStrong" tone="muted">{tr('common.free_demo')}</Text>
        {development ? (
          <Text variant="small" tone="subtle">{tr('admin.OnboardBusinessSheet.not_needed_development_access_has_no')}</Text>
        ) : (
          <>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'flex-start' }}>
              <ChoiceChips value={demo} onChange={setDemo} accessibilityLabel={tr('common.demo_length')}
                options={[
                  { value: '', label: defaultDays === null ? tr('admin.OnboardBusinessSheet.default') : tr('admin.OnboardBusinessSheet.default_v', { v: defaultDays ? tr('admin.OnboardBusinessSheet.defaultdays_days', { defaultDays }) : 'none' }) },
                  { value: '0', label: tr('admin.OnboardBusinessSheet.no_demo') }, { value: '7', label: tr('common.7_days') }, { value: '14', label: tr('admin.OnboardBusinessSheet.14_days') }, { value: '30', label: tr('common.30_days') },
                ]} />
              <Input value={demo} onChangeText={(v) => setDemo(v.replace(/[^0-9]/g, ''))} keyboardType="number-pad" maxLength={3} placeholder={tr('common.days')}
                containerStyle={{ width: 84 }} accessibilityLabel={tr('admin.OnboardBusinessSheet.custom_demo_days')} error={show('demo_days') ? ' ' : undefined} />
            </View>
            {show('demo_days') ? <Text variant="small" tone="danger">{show('demo_days')}</Text> : (
              <Text variant="small" tone="subtle">
                {(demoNum ?? defaultDays) === 0
                  ? tr('admin.OnboardBusinessSheet.no_demo_the_business_is_locked_until_you')
                  : tr('admin.OnboardBusinessSheet.the_business_works_free_for_the_demo_then')}
              </Text>
            )}
          </>
        )}
      </View>
      <SettingSwitch title={tr('common.development_access')} value={development} onValueChange={setDevelopment}
        subtitle={tr('admin.OnboardBusinessSheet.for_internal_or_pilot_owners_works_with')} />
    </Sheet>
  );
}

/** Shows a temporary password exactly once, with copy and share. */
export function CredentialsSheet({ title, heading, message, email, password, onClose, extraAction }: {
  title: string; heading: string; message: string; email: string; password: string | null; onClose: () => void; extraAction?: React.ReactNode;
}) {
  const text = tr('admin.OnboardBusinessSheet.brand_sign_in_email_email_v_please_change', { brand: brand.name, email, v: password ? tr('admin.OnboardBusinessSheet.temporary_password_password', { password }) : '' });
  return (
    <Sheet visible onClose={onClose} title={title} subtitle={password ? tr('admin.OnboardBusinessSheet.this_password_is_shown_only_once') : undefined} width={500}
      footer={
        <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          {extraAction}
          <Button title={tr('common.share')} variant="secondary" icon="share-social-outline" onPress={() => shareText(text, `${brand.name} sign-in`)} />
          <Button title={tr('common.copy')} variant="secondary" icon="copy-outline" onPress={() => copyText(text, 'Sign-in details')} />
          <Button title={tr('common.done')} onPress={onClose} />
        </View>
      }>
      <Callout tone="success" title={heading}>{message}</Callout>
      <Card style={{ gap: 8 }}>
        <Text variant="small" tone="muted">{tr('common.email')}</Text>
        <Text variant="bodyStrong" selectable>{email}</Text>
        {password ? (
          <>
            <Text variant="small" tone="muted" style={{ marginTop: 6 }}>{tr('admin.OnboardBusinessSheet.temporary_password')}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text variant="h2" selectable style={{ letterSpacing: 1, flex: 1 }}>{password}</Text>
              <Button icon="copy-outline" size="sm" variant="ghost" accessibilityLabel={tr('admin.OnboardBusinessSheet.copy_password')} onPress={() => copyText(password, 'Password')} />
            </View>
          </>
        ) : null}
      </Card>
    </Sheet>
  );
}
