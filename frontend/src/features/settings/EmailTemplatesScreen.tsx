/**
 * Settings › Customer emails: is sending set up, business-wide switches (on/off, sender name, reply-to),
 * the four templates with a live preview editor, and the delivery log.
 */
import React, { useEffect, useState } from 'react';
import { Linking, Platform, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { errorMessage, isOffline } from '@/api/client';
import { emailApi, type EmailTemplate, type EmailTemplateKey } from '@/api/email';
import { adminApi } from '@/api/endpoints';
import type { BusinessSettings } from '@/api/types';
import { Badge, Button, Card, EmptyState, ErrorState, Input, Loading, Segmented, Text, toast } from '@/components/ui';
import { TopDialogHost, confirmTop } from '@/features/catalog/dialogs';
import { useApi } from '@/hooks/useApi';
import { getServerUrl } from '@/store/prefs';
import { hasAccess, useAccessInfo } from '@/store/access';
import { can, useAuth } from '@/store/auth';
import { useData } from '@/store/data';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { SettingsFrame } from './SettingsFrame';
import { Callout, FieldRow, FormSection, Hairline, SettingSwitch } from './components';
import { validateEmail } from './validation';
import { DeliveryLog } from './email/DeliveryLog';
import { TemplateEditor } from './email/TemplateEditor';
import { useCanManageTaxes as useCanManageSettings, useOnline } from './taxes/shared';
import { t as tr } from '@/i18n';

const TEMPLATE_ICON: Record<EmailTemplateKey, keyof typeof Ionicons.glyphMap> = {
  loyalty_reward: 'gift-outline',
  offer_announcement: 'megaphone-outline',
  order_receipt: 'receipt-outline',
  welcome: 'hand-left-outline',
};

const MAILPIT_URL = 'http://localhost:8025';

function isLocalServer(): boolean {
  return /localhost|127\.0\.0\.1|10\.0\.2\.2/.test(getServerUrl());
}

export default function EmailTemplatesScreen() {
  const info = useAccessInfo();
  const role = useAuth((s) => s.session?.role ?? null);
  if (info && !info.features.includes('email')) {
    return (
      <SettingsFrame active="emails" title={tr('common.customer_emails')}>
        <EmptyState icon="mail-unread-outline" title={tr('common.not_in_your_plan')} message={tr('settings.EmailTemplatesScreen.customer_emails_aren_t_included_in_your')} />
      </SettingsFrame>
    );
  }
  const allowed = hasAccess(info, { permissions: ['email.manage'], feature: 'email' }) ?? can(role, 'manage');
  if (!allowed) {
    return (
      <SettingsFrame active="emails" title={tr('common.customer_emails')}>
        <EmptyState icon="lock-closed-outline" title={tr('common.managers_only')} message={tr('settings.EmailTemplatesScreen.ask_the_owner_or_a_manager_to_change')} />
      </SettingsFrame>
    );
  }
  return <EmailSettings />;
}

function EmailSettings() {
  const { colors } = useTheme();
  const { isPhone } = useLayout();
  const online = useOnline();
  const canSettings = useCanManageSettings();
  const userEmail = useAuth((s) => s.session?.email ?? '');
  const status = useApi(() => emailApi.status(), [], { refetchOnFocus: false });
  const templates = useApi(() => emailApi.templates(), []);
  const settingsReq = useApi(() => adminApi.settings(), [], { refetchOnFocus: false });
  const cachedSettings = useData((s) => s.settings);
  const settings: BusinessSettings | null = settingsReq.data ?? cachedSettings;

  const [tab, setTab] = useState<'templates' | 'log'>('templates');
  const [selected, setSelected] = useState<EmailTemplateKey | null>(null);
  const [editorDirty, setEditorDirty] = useState(false);
  const [senderName, setSenderName] = useState('');
  const [replyTo, setReplyTo] = useState('');
  const [busy, setBusy] = useState<null | 'enabled' | 'sender'>(null);

  useEffect(() => {
    if (!settings) return;
    setSenderName(settings.email_sender_name ?? '');
    setReplyTo(settings.email_reply_to ?? '');
  }, [settings?.email_sender_name, settings?.email_reply_to]); // eslint-disable-line react-hooks/exhaustive-deps

  const senderDirty = !!settings && (senderName.trim() !== (settings.email_sender_name ?? '') || replyTo.trim() !== (settings.email_reply_to ?? ''));
  const replyError = replyTo.trim() ? validateEmail(replyTo.trim()) : undefined;
  const dirty = editorDirty || senderDirty;
  const enabled = settings?.email_enabled !== false;

  const saveSettings = async (key: 'enabled' | 'sender', body: Partial<BusinessSettings>, ok: string) => {
    setBusy(key);
    try {
      const saved = await adminApi.updateSettings(body);
      settingsReq.setData(saved);
      useData.getState().setSettings(saved);
      toast.success(ok);
    } catch (e) {
      toast.error(isOffline(e) ? tr('settings.EmailTemplatesScreen.you_re_offline_try_again_when_you_re') : errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const openTemplate = async (key: EmailTemplateKey | null) => {
    if (editorDirty && !(await confirmTop({ title: tr('common.discard_unsaved_changes'), message: tr('settings.EmailTemplatesScreen.your_changes_to_this_email_have_not_been'), confirmLabel: tr('common.discard'), danger: true }))) return;
    setEditorDirty(false);
    setSelected(key);
  };

  const reloadAll = () => {
    void status.reload();
    void templates.reload();
    void settingsReq.reload();
  };

  const list = templates.data ?? [];
  const current = list.find((t) => t.key === selected) ?? null;
  const placeholders = status.data?.placeholders ?? [];
  const local = isLocalServer();

  const statusBanner = status.loading && !status.data ? null : !status.data ? (
    <Callout tone="warning" title={tr('settings.EmailTemplatesScreen.couldn_t_check_email_setup')} action={<Button title={tr('common.try_again')} size="sm" variant="secondary" icon="refresh" onPress={status.reload} />}>
      {status.error ?? tr('settings.EmailTemplatesScreen.unknown_error')}
    </Callout>
  ) : status.data.configured ? (
    <Callout tone="success" icon="mail-outline" title={tr('settings.EmailTemplatesScreen.email_sending_is_set_up')}
      action={local && Platform.OS === 'web' ? <Button title={tr('settings.EmailTemplatesScreen.open_mailpit')} size="sm" variant="secondary" icon="open-outline" onPress={() => void Linking.openURL(MAILPIT_URL)} /> : undefined}>
      {local
        ? tr('settings.EmailTemplatesScreen.development_server_every_email_is_caught', { MAILPIT_URL })
        : tr('settings.EmailTemplatesScreen.customers_who_share_their_email_get_the')}
    </Callout>
  ) : (
    <Callout tone="warning" title={tr('settings.EmailTemplatesScreen.email_sending_isn_t_set_up_on_the_server')}>
      {tr('settings.EmailTemplatesScreen.emails_are_logged_as_skipped_until_the')}
    </Callout>
  );

  return (
    <SettingsFrame active="emails" title={tr('common.customer_emails')} subtitle={tr('settings.EmailTemplatesScreen.rewards_offers_welcome_notes_and_e')}
      dirty={dirty} maxWidth={current ? 1280 : 960} refreshing={templates.refreshing} onRefresh={reloadAll}>
      {!online ? (
        <Callout tone="warning" icon="cloud-offline-outline" title={tr('common.you_re_offline')}>{tr('settings.EmailTemplatesScreen.changes_and_previews_need_a_connection')}</Callout>
      ) : null}
      {statusBanner}

      {!current ? (
        <Segmented<'templates' | 'log'> value={tab} onChange={setTab}
          options={[{ value: 'templates', label: tr('settings.EmailTemplatesScreen.templates'), icon: 'mail-outline' }, { value: 'log', label: tr('settings.EmailTemplatesScreen.delivery_log'), icon: 'list-outline' }]} />
      ) : null}

      {current ? (
        <TemplateEditor key={current.key} template={current} placeholders={placeholders} canEdit online={online} emailEnabled={enabled}
          defaultTestTo={settings?.email ?? userEmail ?? ''} onDirtyChange={setEditorDirty} onBack={() => void openTemplate(null)}
          onSaved={(t: EmailTemplate) => templates.setData((ts) => (ts ?? []).map((x) => (x.key === t.key ? { ...x, ...t } : x)))} />
      ) : tab === 'log' ? (
        <DeliveryLog templates={list} />
      ) : (
        <>
          <FormSection title={tr('settings.EmailTemplatesScreen.sending')} description={tr('settings.EmailTemplatesScreen.turn_customer_emails_on_or_off_for_the')}>
            {settings ? (
              <>
                <SettingSwitch title={tr('settings.EmailTemplatesScreen.send_emails_to_customers')} value={enabled} disabled={!canSettings || !online || busy !== null}
                  onValueChange={(v) => saveSettings('enabled', { email_enabled: v }, v ? 'Customer emails turned on' : 'Customer emails turned off')}
                  subtitle={enabled ? tr('settings.EmailTemplatesScreen.on_only_customers_with_an_email_address') : tr('settings.EmailTemplatesScreen.off_no_emails_are_sent_to_customers')} />
                <Hairline />
                <FieldRow>
                  <Input label={tr('settings.EmailTemplatesScreen.sender_name')} value={senderName} onChangeText={setSenderName} maxLength={80} editable={canSettings}
                    placeholder={settings.business_name} hint={tr('settings.EmailTemplatesScreen.shown_as_from_in_the_inbox_empty_uses')} />
                  <Input label={tr('settings.EmailTemplatesScreen.reply_to_email')} value={replyTo} onChangeText={setReplyTo} keyboardType="email-address" autoCapitalize="none"
                    autoCorrect={false} editable={canSettings} placeholder={settings.email ?? 'you@yourshop.in'} error={replyError}
                    hint={tr('settings.EmailTemplatesScreen.customer_replies_go_here')} />
                </FieldRow>
                {senderDirty && canSettings ? (
                  <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end' }}>
                    <Button title={tr('common.discard')} variant="secondary" onPress={() => { setSenderName(settings.email_sender_name ?? ''); setReplyTo(settings.email_reply_to ?? ''); }} disabled={busy !== null} />
                    <Button title={tr('common.save')} icon="checkmark" loading={busy === 'sender'} disabled={busy !== null || !!replyError || !online}
                      onPress={() => saveSettings('sender', { email_sender_name: senderName.trim() || null, email_reply_to: replyTo.trim() || null }, 'Sender details saved')} />
                  </View>
                ) : null}
                {!canSettings ? <Text variant="small" tone="subtle">{tr('settings.EmailTemplatesScreen.only_users_with_settings_access_can')}</Text> : null}
              </>
            ) : settingsReq.loading ? <Loading /> : <ErrorState message={settingsReq.error ?? tr('settings.EmailTemplatesScreen.could_not_load_settings')} onRetry={settingsReq.reload} />}
          </FormSection>

          <View style={{ gap: 12 }}>
            <View style={{ gap: 2 }}>
              <Text variant="h3" accessibilityRole="header">{tr('settings.EmailTemplatesScreen.emails')}</Text>
              <Text variant="small" tone="muted">{tr('settings.EmailTemplatesScreen.tap_an_email_to_change_its_words_and')}</Text>
            </View>
            {templates.loading && !templates.data ? <Loading label={tr('settings.EmailTemplatesScreen.loading_emails')} /> : !templates.data ? (
              <ErrorState message={templates.error ?? tr('settings.EmailTemplatesScreen.could_not_load_email_templates')} onRetry={templates.reload} />
            ) : !list.length ? (
              <Card><EmptyState icon="mail-outline" title={tr('settings.EmailTemplatesScreen.no_email_templates')} message={tr('settings.EmailTemplatesScreen.templates_will_appear_here_once_the')} /></Card>
            ) : (
              <View style={{ gap: 10 }}>
                {list.map((t) => (
                  <Card key={t.key} onPress={() => void openTemplate(t.key)} style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
                    <View style={{ width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
                      backgroundColor: t.enabled ? colors.primarySoft : colors.surfaceSunken }}>
                      <Ionicons name={TEMPLATE_ICON[t.key] ?? 'mail-outline'} size={22} color={t.enabled ? colors.primarySoftText : colors.textSubtle} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <Text variant="bodyStrong">{t.label}</Text>
                        {t.customised ? <Badge label={tr('settings.EmailTemplatesScreen.customised')} tone="primary" /> : null}
                        {!t.enabled ? <Badge label={tr('common.off')} tone="warning" /> : null}
                      </View>
                      <Text variant="small" tone="muted" numberOfLines={isPhone ? 3 : 2}>{t.description}</Text>
                      <Text variant="small" tone="subtle" numberOfLines={1}>{tr('settings.EmailTemplatesScreen.subject')} {t.subject}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.textSubtle} />
                  </Card>
                ))}
              </View>
            )}
          </View>
        </>
      )}
      <TopDialogHost />
    </SettingsFrame>
  );
}
