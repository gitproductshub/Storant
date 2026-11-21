/**
 * Platform settings: free demo length for new businesses, grace and reminder days, the payment details owners see on the
 * renewal page, and the daily subscription check (01:00 India time) with "Run check now".
 */
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { errorMessage } from '@/api/client';
import { platformApi, type JobsInfo, type PlatformSettings } from '@/api/platform';
import { Badge, Button, Card, Divider, ErrorState, Input, Loading, Text, confirm, toast } from '@/components/ui';
import { useApi } from '@/hooks/useApi';
import { ago, formatDateTime } from '@/lib/format';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { Callout, ChoiceChips, FieldRow, KeyValue, SaveBar } from '@/features/settings/components';
import { validateEmail } from '@/features/settings/validation';
import { AdminPage, ReadOnlyNote, plural, useCanEdit, useOnline } from './shared';
import { brand } from '@/config/brand';
import { t as tr, currentLocale } from '@/i18n';

interface Draft {
  trialDays: string;
  graceDays: string;
  reminderDays: string;
  upiId: string;
  payeeName: string;
  bankDetails: string;
  supportPhone: string;
  supportEmail: string;
  instructions: string;
}

const DEMO_CHOICES = [0, 7, 14, 30];

function draftFrom(s: PlatformSettings): Draft {
  return {
    trialDays: String(s.trial_days), graceDays: String(s.grace_days), reminderDays: String(s.reminder_days),
    upiId: s.payment.upi_id ?? '', payeeName: s.payment.payee_name ?? '', bankDetails: s.payment.bank_details ?? '',
    supportPhone: s.payment.support_phone ?? '', supportEmail: s.payment.support_email ?? '', instructions: s.payment.instructions ?? '',
  };
}

function wholeIn(v: string, max: number): number | null {
  const t = v.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n <= max ? n : null;
}

export function daysLabel(n: number): string {
  return n === 0 ? 'No demo' : `${n} day${n === 1 ? '' : 's'}`;
}

/** "in 5 h 20 min" until a future time. */
function untilText(iso: string, now = Date.now()): string {
  const mins = Math.max(0, Math.round((new Date(iso).getTime() - now) / 60_000));
  if (mins < 60) return `in ${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h >= 24 ? `in ${Math.floor(h / 24)} d ${h % 24} h` : `in ${h} h${m ? ` ${m} min` : ''}`;
}

export default function PlatformSettingsScreen() {
  const { width } = useLayout();
  const canEdit = useCanEdit();
  const online = useOnline();
  const settings = useApi(() => platformApi.settings(), []);
  const jobs = useApi(() => platformApi.jobs(), []);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const baseline = useMemo(() => (settings.data ? draftFrom(settings.data) : null), [settings.data]);
  const form = draft ?? baseline;
  const dirty = !!(draft && baseline && JSON.stringify(draft) !== JSON.stringify(baseline));
  const twoCol = width >= 1180;

  const edit = (patch: Partial<Draft>) => form && setDraft({ ...form, ...patch });

  const errors: Record<string, string | undefined> = form ? {
    trialDays: wholeIn(form.trialDays, 365) === null ? '0–365 days.' : undefined,
    graceDays: wholeIn(form.graceDays, 60) === null ? '0–60 days.' : undefined,
    reminderDays: wholeIn(form.reminderDays, 60) === null ? '0–60 days.' : undefined,
    supportEmail: form.supportEmail.trim() ? validateEmail(form.supportEmail, false) : undefined,
    payeeName: form.upiId.trim() && !form.payeeName.trim() ? 'Who the UPI app should show as the payee.' : undefined,
  } : {};
  const hasErrors = Object.values(errors).some(Boolean);

  const save = async () => {
    if (!form || hasErrors) {
      toast.error(tr('admin.PlatformSettingsScreen.fix_the_highlighted_fields_before_saving'));
      return;
    }
    setSaving(true);
    try {
      const next = await platformApi.saveSettings({
        trial_days: Number(form.trialDays.trim()), grace_days: Number(form.graceDays.trim()), reminder_days: Number(form.reminderDays.trim()),
        payment: {
          upi_id: form.upiId.trim(), payee_name: form.payeeName.trim(), bank_details: form.bankDetails.trim(),
          support_phone: form.supportPhone.trim(), support_email: form.supportEmail.trim(), instructions: form.instructions.trim(),
        },
      });
      settings.setData(next);
      setDraft(null);
      toast.success(tr('admin.PlatformSettingsScreen.platform_settings_saved'));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  if (!form) {
    return (
      <AdminPage title={tr('admin.PlatformSettingsScreen.platform_settings')}>
        {settings.loading ? <Loading label={tr('admin.PlatformSettingsScreen.loading_settings')} /> : null}
        {settings.error && !settings.loading ? <ErrorState message={settings.error} onRetry={settings.reload} /> : null}
      </AdminPage>
    );
  }

  const demoCard = <DemoCard form={form} errors={errors} canEdit={canEdit} onChange={edit} />;
  const renewalCard = <RenewalCard form={form} errors={errors} canEdit={canEdit} onChange={edit} />;
  const paymentCard = <PaymentCard form={form} errors={errors} canEdit={canEdit} onChange={edit} />;
  const jobCard = <JobCard data={jobs.data} loading={jobs.loading} error={jobs.error} onRetry={jobs.reload} canEdit={canEdit} onRan={() => void jobs.silentReload()} />;

  return (
    <AdminPage
      title={tr('admin.PlatformSettingsScreen.platform_settings')}
      subtitle={tr('admin.PlatformSettingsScreen.demo_length_grace_days_how_owners_pay_you')}
      refreshing={settings.refreshing}
      onRefresh={() => { void settings.reload(); void jobs.reload(); }}
      footer={canEdit ? (
        <SaveBar visible={dirty} saving={saving} onSave={save} onDiscard={() => setDraft(null)} disabled={!online || hasErrors}
          message={online ? tr('admin.PlatformSettingsScreen.unsaved_platform_settings') : tr('admin.PlatformSettingsScreen.you_re_offline_changes_can_t_be_saved_yet')} />
      ) : null}
    >
      {!canEdit ? <ReadOnlyNote what="change platform settings" /> : null}
      {twoCol ? (
        <View style={{ flexDirection: 'row', gap: 20, alignItems: 'flex-start' }}>
          <View style={{ flex: 1.4, minWidth: 0, gap: 20 }}>
            {demoCard}
            {renewalCard}
            {paymentCard}
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 20 }}>{jobCard}</View>
        </View>
      ) : (
        <View style={{ gap: 20 }}>
          {demoCard}
          {renewalCard}
          {paymentCard}
          {jobCard}
        </View>
      )}
    </AdminPage>
  );
}

interface CardProps { form: Draft; errors: Record<string, string | undefined>; canEdit: boolean; onChange: (patch: Partial<Draft>) => void }

function CardTitle({ title, subtitle, right }: { title: string; subtitle?: string; right?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="h3" accessibilityRole="header">{title}</Text>
        {subtitle ? <Text variant="small" tone="muted">{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

function DemoCard({ form, errors, canEdit, onChange }: CardProps) {
  const n = wholeIn(form.trialDays, 365);
  return (
    <Card style={{ gap: 12 }}>
      <CardTitle title={tr('admin.PlatformSettingsScreen.free_demo_for_new_businesses')} subtitle={tr('admin.PlatformSettingsScreen.every_new_sign_up_and_businesses_you', { brand: brand.name })}
        right={<Badge label={n === null ? '—' : daysLabel(n)} tone={n ? 'info' : 'neutral'} icon="hourglass-outline" />} />
      {canEdit ? (
        <View style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'flex-start' }}>
            <ChoiceChips value={n !== null && DEMO_CHOICES.includes(n) ? String(n) : ''} onChange={(v) => onChange({ trialDays: v })} accessibilityLabel={tr('common.demo_length')}
              options={DEMO_CHOICES.map((d) => ({ value: String(d), label: daysLabel(d) }))} />
            <Input value={form.trialDays} onChangeText={(v) => onChange({ trialDays: v.replace(/[^0-9]/g, '') })} keyboardType="number-pad" maxLength={3}
              containerStyle={{ width: 100 }} accessibilityLabel={tr('admin.PlatformSettingsScreen.demo_days')} error={errors.trialDays ? ' ' : undefined} />
          </View>
          {errors.trialDays ? <Text variant="small" tone="danger">{errors.trialDays}</Text> : null}
        </View>
      ) : null}
      <Text variant="small" tone="subtle">
        {tr('admin.PlatformSettingsScreen.0_no_demo_new_businesses_are_locked_until')}
      </Text>
    </Card>
  );
}

function RenewalCard({ form, errors, canEdit, onChange }: CardProps) {
  const grace = wholeIn(form.graceDays, 60);
  if (!canEdit) {
    return (
      <Card style={{ gap: 6 }}>
        <CardTitle title={tr('admin.PlatformSettingsScreen.renewal')} />
        <KeyValue label={tr('admin.PlatformSettingsScreen.grace_days')} value={form.graceDays} />
        <KeyValue label={tr('admin.PlatformSettingsScreen.reminder_days')} value={form.reminderDays} />
      </Card>
    );
  }
  return (
    <Card style={{ gap: 12 }}>
      <CardTitle title={tr('admin.PlatformSettingsScreen.renewal')} subtitle={tr('admin.PlatformSettingsScreen.what_happens_around_the_end_of_a_paid')} />
      <FieldRow>
        <Input label={tr('admin.PlatformSettingsScreen.grace_days')} value={form.graceDays} onChangeText={(v) => onChange({ graceDays: v.replace(/[^0-9]/g, '') })} keyboardType="number-pad"
          maxLength={2} error={errors.graceDays}
          hint={grace ? tr('admin.PlatformSettingsScreen.keeps_working_grace_day_v_after_the_paid', { grace, v: grace === 1 ? '' : 's' }) : tr('admin.PlatformSettingsScreen.locks_on_the_day_the_paid_period_ends')} />
        <Input label={tr('admin.PlatformSettingsScreen.reminder_days')} value={form.reminderDays} onChangeText={(v) => onChange({ reminderDays: v.replace(/[^0-9]/g, '') })} keyboardType="number-pad"
          maxLength={2} error={errors.reminderDays} hint={tr('admin.PlatformSettingsScreen.owners_see_a_renewal_reminder_this_many')} />
      </FieldRow>
    </Card>
  );
}

function PaymentCard({ form, errors, canEdit, onChange }: CardProps) {
  const { colors, radius } = useTheme();
  const preview = (
    <View style={{ padding: 12, borderRadius: radius.md, backgroundColor: colors.surfaceSunken, gap: 4 }}>
      <Text variant="caption" tone="subtle">{tr('admin.PlatformSettingsScreen.what_owners_see')}</Text>
      {form.upiId.trim() ? <Text variant="smallStrong">{tr('admin.PlatformSettingsScreen.upi')} {form.upiId.trim()}{form.payeeName.trim() ? ` (${form.payeeName.trim()})` : ''}</Text> : <Text variant="small" tone="warning">{tr('admin.PlatformSettingsScreen.no_upi_id_yet_owners_can_t_pay_by_upi')}</Text>}
      {form.bankDetails.trim() ? <Text variant="small">{form.bankDetails.trim()}</Text> : null}
      {form.instructions.trim() ? <Text variant="small" tone="muted">{form.instructions.trim()}</Text> : null}
      {form.supportPhone.trim() || form.supportEmail.trim() ? (
        <Text variant="small" tone="muted">{tr('admin.PlatformSettingsScreen.help')} {[form.supportPhone.trim(), form.supportEmail.trim()].filter(Boolean).join(' · ')}</Text>
      ) : null}
    </View>
  );
  if (!canEdit) {
    return (
      <Card style={{ gap: 10 }}>
        <CardTitle title={tr('admin.PlatformSettingsScreen.how_owners_pay')} subtitle={tr('admin.PlatformSettingsScreen.shown_on_the_renewal_page_of_a_locked_or')} />
        {preview}
      </Card>
    );
  }
  return (
    <Card style={{ gap: 12 }}>
      <CardTitle title={tr('admin.PlatformSettingsScreen.how_owners_pay')} subtitle={tr('admin.PlatformSettingsScreen.shown_on_the_renewal_page_of_a_locked_or')} />
      <FieldRow>
        <Input label={tr('admin.PlatformSettingsScreen.upi_id')} value={form.upiId} onChangeText={(upiId) => onChange({ upiId })} maxLength={80} autoCapitalize="none" autoCorrect={false}
          placeholder="storant@okhdfcbank" />
        <Input label={tr('admin.PlatformSettingsScreen.payee_name')} value={form.payeeName} onChangeText={(payeeName) => onChange({ payeeName })} maxLength={80} error={errors.payeeName}
          placeholder={brand.name} />
      </FieldRow>
      <Input label={tr('admin.PlatformSettingsScreen.bank_details')} value={form.bankDetails} onChangeText={(bankDetails) => onChange({ bankDetails })} maxLength={400} multiline
        placeholder={tr('admin.PlatformSettingsScreen.a_c_1234567890_ifsc_hdfc0001234_storant')} style={{ minHeight: 72, textAlignVertical: 'top', paddingTop: 10 }} />
      <FieldRow>
        <Input label={tr('admin.PlatformSettingsScreen.support_phone')} value={form.supportPhone} onChangeText={(supportPhone) => onChange({ supportPhone })} maxLength={30} keyboardType="phone-pad"
          placeholder="+91 98765 43210" />
        <Input label={tr('admin.PlatformSettingsScreen.support_email')} value={form.supportEmail} onChangeText={(supportEmail) => onChange({ supportEmail })} maxLength={120} keyboardType="email-address"
          autoCapitalize="none" autoCorrect={false} error={errors.supportEmail} placeholder="billing@storant.in" />
      </FieldRow>
      <Input label={tr('admin.PlatformSettingsScreen.instructions')} value={form.instructions} onChangeText={(instructions) => onChange({ instructions })} maxLength={600} multiline
        style={{ minHeight: 88, textAlignVertical: 'top', paddingTop: 10 }} hint={`${form.instructions.length}/600`} />
      {preview}
    </Card>
  );
}

function JobCard({ data, loading, error, onRetry, canEdit, onRan }: {
  data: JobsInfo | null; loading: boolean; error: string | null; onRetry: () => void; canEdit: boolean; onRan: () => void;
}) {
  const online = useOnline();
  const [running, setRunning] = useState(false);
  const job = data?.subscription_check;
  const last = job?.last_run ?? null;

  const runNow = async () => {
    const ok = await confirm({
      title: tr('admin.PlatformSettingsScreen.run_the_subscription_check_now'), confirmLabel: tr('admin.PlatformSettingsScreen.run_check'), danger: true,
      message: tr('admin.PlatformSettingsScreen.businesses_whose_subscription_plus_grace'),
    });
    if (!ok) return;
    setRunning(true);
    try {
      const r = await platformApi.runSubscriptionCheck();
      toast.success(tr('admin.PlatformSettingsScreen.check_done_plural_checked_locked_now', { plural: plural(r.businesses_checked, 'business', 'businesses'), locked_now: r.locked_now }));
      onRan();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card style={{ gap: 12 }}>
      <CardTitle title={tr('admin.PlatformSettingsScreen.daily_subscription_check')}
        subtitle={tr('admin.PlatformSettingsScreen.locks_businesses_whose_subscription_ended')}
        right={job ? <Badge label={job.enabled ? tr('common.scheduled') : tr('common.off')} tone={job.enabled ? 'success' : 'warning'} icon={job.enabled ? 'time-outline' : 'pause-outline'} /> : undefined} />
      {loading && !data ? <Loading /> : null}
      {error && !data ? <ErrorState message={error} onRetry={onRetry} /> : null}
      {job ? (
        <>
          <View style={{ gap: 2 }}>
            <KeyValue label={tr('admin.PlatformSettingsScreen.schedule')} value={job.schedule} />
            <KeyValue label={tr('admin.PlatformSettingsScreen.next_run')} value={job.enabled ? `${formatDateTime(job.next_run_at)} (${untilText(job.next_run_at)})` : 'Not scheduled on this server'} />
          </View>
          {!job.enabled ? <Callout tone="warning">{tr('admin.PlatformSettingsScreen.the_scheduler_is_switched_off_on_this')}</Callout> : null}
          <Divider />
          <Text variant="smallStrong" tone="muted">{tr('admin.PlatformSettingsScreen.last_run')}</Text>
          {last ? (
            <View style={{ gap: 10 }}>
              <Text variant="small" tone="muted">{formatDateTime(last.last_run_at)} {tr('admin.PlatformSettingsScreen.ago_ago_by', { ago: ago(last.last_run_at) })} {last.by}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                <MiniStat label={tr('admin.PlatformSettingsScreen.checked')} value={last.businesses_checked.toLocaleString(currentLocale())} />
                <MiniStat label={tr('common.locked')} value={last.locked_now.toLocaleString(currentLocale())} tone={last.locked_now ? 'danger' : undefined} />
                <MiniStat label={tr('admin.PlatformSettingsScreen.due_soon')} value={last.renewals_due_soon.toLocaleString(currentLocale())} tone={last.renewals_due_soon ? 'warning' : undefined} />
                <MiniStat label={tr('admin.PlatformSettingsScreen.took')} value={`${last.duration_ms} ms`} />
              </View>
            </View>
          ) : <Text variant="small" tone="subtle">{tr('admin.PlatformSettingsScreen.hasn_t_run_yet')}</Text>}
          {canEdit ? (
            <Button title={tr('admin.PlatformSettingsScreen.run_check_now')} icon="play-circle-outline" variant="secondary" onPress={runNow} loading={running} disabled={!online} style={{ alignSelf: 'flex-start' }} />
          ) : null}
        </>
      ) : null}
    </Card>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: 'danger' | 'warning' }) {
  const { colors, radius } = useTheme();
  return (
    <View style={{ flexGrow: 1, flexBasis: 110, padding: 10, borderRadius: radius.md, backgroundColor: colors.surfaceSunken, gap: 2 }}>
      <Text variant="caption" tone="subtle">{label.toUpperCase()}</Text>
      <Text variant="h3" tone={tone ?? 'default'}>{value}</Text>
    </View>
  );
}
