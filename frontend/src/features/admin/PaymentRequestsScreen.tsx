/**
 * Payment requests: owners say "I've paid" (UPI / bank reference) from the renewal page. Check the money arrived, then approve
 * (records the subscription and unlocks the business) or reject with a reason the owner sees.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { errorMessage } from '@/api/client';
import { platformApi, type PaymentRequest, type PaymentRequestStatus } from '@/api/platform';
import { ActionMenu, Badge, Button, Card, DataList, FilterBar, Input, Segmented, Sheet, StatusPill, Text, toast, type BadgeTone, type DataColumn } from '@/components/ui';
import { useApi } from '@/hooks/useApi';
import { usePagedList } from '@/hooks/usePagedList';
import { ago, formatDateTime, money } from '@/lib/format';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { Callout, KeyValue, copyText, monoFont } from '@/features/settings/components';
import { AdminListFrame, PAYMENT_METHOD_LABEL, ReadOnlyNote, goTo, setPendingPayments, useCanEdit, useOnline } from './shared';
import { brand } from '@/config/brand';
import { t as tr, currentLocale } from '@/i18n';

type Filter = PaymentRequestStatus | 'all';
const PAGE = 50;
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'pending', get label() { return tr('common.pending'); } }, { value: 'approved', get label() { return tr('admin.PaymentRequestsScreen.approved'); } }, { value: 'rejected', get label() { return tr('admin.PaymentRequestsScreen.rejected'); } }, { value: 'all', get label() { return tr('common.all'); } },
];
const STATUS_LABEL: Record<PaymentRequestStatus, string> = { get pending() { return tr('admin.PaymentRequestsScreen.waiting_for_review'); }, get approved() { return tr('admin.PaymentRequestsScreen.approved'); }, get rejected() { return tr('admin.PaymentRequestsScreen.rejected'); } };
const STATUS_TONE: Record<PaymentRequestStatus, BadgeTone> = { pending: 'warning', approved: 'success', rejected: 'danger' };

export function monthsText(months: number): string {
  if (months === 12) return '1 year';
  if (months > 12 && months % 12 === 0) return `${months / 12} years`;
  return `${months} month${months === 1 ? '' : 's'}`;
}

/** Claimed amount differs from what the plan + offer cost now (by more than 50 paise). */
function mismatch(r: PaymentRequest): number | null {
  if (r.expected_amount === undefined || r.expected_amount === null) return null;
  const diff = Math.round((r.amount - r.expected_amount) * 100) / 100;
  return Math.abs(diff) >= 0.5 ? diff : null;
}

export default function PaymentRequestsScreen() {
  const { isPhone } = useLayout();
  const canEdit = useCanEdit();
  const online = useOnline();
  const params = useLocalSearchParams<{ status?: string }>();
  const initial = FILTERS.some((f) => f.value === params.status) ? (params.status as Filter) : 'pending';
  const [filter, setFilter] = useState<Filter>(initial);
  const [query, setQuery] = useState('');
  const [acting, setActing] = useState<{ request: PaymentRequest; mode: 'approve' | 'reject' | 'view'; reason?: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const plans = useApi(() => platformApi.plans(), []);
  // Server search + paging; only the Pending chip gets a count (approved / declined grow forever)
  const list = usePagedList<PaymentRequest>(
    async (offset, limit) => { const r = await platformApi.paymentRequestsPage(filter, { q: query, offset, limit }); return { items: r.items, total: r.total }; },
    `${filter}|${query.trim()}`, { pageSize: PAGE, idOf: (r) => r.id },
  );
  // Counts per status for the chips and the sidebar badge (one tiny request; totals come from the server)
  const pending = useApi(() => platformApi.paymentRequestsPage('all', { limit: 1 }), []);
  const statusCounts = pending.data?.counts;

  useEffect(() => {
    if (params.status && FILTERS.some((f) => f.value === params.status)) setFilter(params.status as Filter);
  }, [params.status]);

  // Keep the nav badge in step with what this screen shows
  useEffect(() => {
    if (statusCounts) setPendingPayments(statusCounts.pending ?? 0);
  }, [statusCounts]);

  const planName = useCallback((key: string) => plans.data?.plans.find((p) => p.key === key)?.name ?? key, [plans.data]);
  const q = query.trim();
  const items = list.items;


  const changeFilter = (f: string) => {
    setFilter(f as Filter);
    router.setParams({ status: f === 'pending' ? undefined : f });
  };

  const done = (id: string) => {
    if (filter === 'pending') list.setItems((rows) => rows.filter((r) => r.id !== id));
    void list.refreshSilently();
    void pending.reload();
    setActing(null);
  };

  /** Decline in place with one of the usual reasons (the owner sees it and can send a new claim). */
  const decline = async (r: PaymentRequest, reason: string) => {
    setBusyId(r.id);
    try {
      await platformApi.rejectPaymentRequest(r.id, reason);
      toast.success(tr('admin.PaymentRequestsScreen.claim_from_business_name_declined', { business_name: r.business_name }));
      done(r.id);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusyId(null);
    }
  };

  const actions = useCallback((r: PaymentRequest) => {
    if (r.status !== 'pending' || !canEdit) {
      return <Text variant="caption" tone="subtle" numberOfLines={1}>{r.reviewed_by ?? ''}</Text>;
    }
    return (
      <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
        <Button title={isPhone ? undefined : tr('admin.PaymentRequestsScreen.approve')} icon="checkmark" variant="success" size="sm" accessibilityLabel={tr('admin.PaymentRequestsScreen.approve_business_name', { business_name: r.business_name })}
          onPress={() => setActing({ request: r, mode: 'approve' })} disabled={!online || busyId === r.id} disabledReason={tr('admin.PaymentRequestsScreen.you_re_offline_x')} />
        <ActionMenu align="end" title={tr('admin.PaymentRequestsScreen.decline_with_a_reason')}
          items={[
            ...REJECT_REASONS.map((reason) => ({ key: reason, label: reason, icon: 'close-circle-outline' as const, onPress: () => void decline(r, reason) })),
            { key: 'other', label: tr('admin.PaymentRequestsScreen.other_reason'), icon: 'create-outline', group: 'other', onPress: () => setActing({ request: r, mode: 'reject' }) },
          ]}
          trigger={(open) => <Button title={isPhone ? undefined : tr('admin.PaymentRequestsScreen.decline')} icon="close" variant="dangerOutline" size="sm" accessibilityLabel={tr('admin.PaymentRequestsScreen.decline_business_name', { business_name: r.business_name })}
            onPress={open} loading={busyId === r.id} disabled={!online} disabledReason={tr('admin.PaymentRequestsScreen.you_re_offline_x')} />} />
      </View>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit, online, busyId, isPhone]);

  const columns = useMemo<DataColumn<PaymentRequest>[]>(() => [
    { key: 'business', title: tr('common.business'), flex: 2.2, render: (r) => (
      <View style={{ minWidth: 0 }}>
        <Text variant="bodyStrong" numberOfLines={1}>{r.business_name}</Text>
        <Text variant="small" tone="muted" numberOfLines={1}>{planName(r.plan_key)} · {monthsText(r.months)}{r.offer_code ? ` · ${r.offer_code}` : ''}</Text>
      </View>
    ) },
    { key: 'reference', title: tr('admin.PaymentRequestsScreen.reference'), flex: 1.4, hideBelow: 820, render: (r) => (
      <View style={{ minWidth: 0 }}>
        <Text variant="small" numberOfLines={1} style={{ fontFamily: monoFont }} selectable>{r.reference || '—'}</Text>
        <Text variant="caption" tone="subtle" numberOfLines={1}>{PAYMENT_METHOD_LABEL[r.method] ?? r.method}</Text>
      </View>
    ) },
    { key: 'amount', title: tr('admin.PaymentRequestsScreen.claimed'), width: 140, align: 'right', render: (r) => {
      const diff = mismatch(r);
      return (
        <View style={{ alignItems: 'flex-end' }}>
          <Text variant="bodyStrong" style={{ fontVariant: ['tabular-nums'] }}>{money(r.amount)}</Text>
          {r.status === 'pending' && r.offer_error ? <Text variant="caption" tone="warning" numberOfLines={1}>{tr('admin.PaymentRequestsScreen.offer_ended')}</Text>
            : r.status === 'pending' && diff !== null ? <Text variant="caption" tone="warning" numberOfLines={1}>{tr('admin.PaymentRequestsScreen.expected_money', { money: money(r.expected_amount!) })}</Text>
              : r.status === 'pending' && r.expected_amount !== undefined ? <Text variant="caption" tone="success" numberOfLines={1}>{tr('admin.PaymentRequestsScreen.matches_price')}</Text> : null}
        </View>
      );
    } },
    { key: 'sent', title: tr('common.sent'), width: 96, hideBelow: 700, value: (r) => `${ago(r.created_at)} ago` },
    { key: 'status', title: tr('common.status'), width: 130, hideBelow: 980, render: (r) => <StatusPill status={r.status === 'pending' ? 'claim' : r.status === 'approved' ? 'paid' : 'cancelled'}
      label={r.status === 'pending' ? tr('common.waiting') : r.status === 'approved' ? tr('admin.PaymentRequestsScreen.approved') : tr('admin.PaymentRequestsScreen.declined')} /> },
  ], [planName]);

  const renderCard = useCallback((r: PaymentRequest) => (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>{r.business_name}</Text>
        <Text variant="bodyStrong" style={{ fontVariant: ['tabular-nums'] }}>{money(r.amount)}</Text>
      </View>
      <Text variant="small" tone="muted" numberOfLines={1}>
        {planName(r.plan_key)} · {monthsText(r.months)} · {r.reference || tr('admin.PaymentRequestsScreen.no_reference')} {tr('admin.PaymentRequestsScreen.ago_ago', { ago: ago(r.created_at) })}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {r.status === 'pending' && (r.offer_error || mismatch(r) !== null)
          ? <StatusPill status="pending" label={r.offer_error ? tr('admin.PaymentRequestsScreen.offer_ended') : tr('admin.PaymentRequestsScreen.amount_differs')} />
          : <StatusPill status={r.status === 'pending' ? 'claim' : r.status === 'approved' ? 'paid' : 'cancelled'}
            label={r.status === 'pending' ? tr('common.waiting') : r.status === 'approved' ? tr('admin.PaymentRequestsScreen.approved') : tr('admin.PaymentRequestsScreen.declined')} />}
        <View style={{ flex: 1 }} />
        {actions(r)}
      </View>
    </View>
  ), [planName, actions]);

  return (
    <AdminListFrame
      title={tr('admin.PaymentRequestsScreen.payment_requests')}
      subtitle={tr('admin.PaymentRequestsScreen.owners_say_they_ve_paid_from_the_renewal')}
      toolbar={
        <View style={{ gap: 8 }}>
          <FilterBar onSearch={setQuery} searchPlaceholder={tr('admin.PaymentRequestsScreen.business_reference_or_email_x')}
            filters={FILTERS.map((f) => ({ key: f.value, label: f.label, count: statusCounts ? (statusCounts[f.value] ?? 0) : undefined }))}
            value={filter} onChange={changeFilter} />
          {!canEdit ? <ReadOnlyNote what="approve or decline payments" /> : null}
        </View>
      }
    >
      <DataList
        data={items}
        keyExtractor={(r) => r.id}
        columns={columns}
        renderCard={renderCard}
        rowHeight={60}
        cardHeight={112}
        tableMinWidth={620}
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
        refreshing={list.refreshing}
        onRefresh={() => { void list.reload(); void plans.reload(); void pending.reload(); }}
        onEndReached={list.loadMore}
        loadingMore={list.loadingMore}
        hasMore={list.hasMore}
        openKey={acting?.mode === 'view' ? acting.request.id : null}
        onPressRow={(r) => setActing({ request: r, mode: 'view' })}
        keyboard={!acting}
        rowActions={actions}
        rowActionsWidth={isPhone ? 110 : 220}
        extraData={busyId}
        empty={filter === 'pending' && !q
          ? { icon: 'checkmark-done-outline', title: tr('common.all_caught_up'), message: tr('admin.PaymentRequestsScreen.no_payment_claims_are_waiting_new_ones') }
          : { icon: 'wallet-outline', title: tr('admin.PaymentRequestsScreen.nothing_here'), message: q ? tr('admin.PaymentRequestsScreen.no_claim_matches_that_search') : tr('admin.PaymentRequestsScreen.no_v_payment_requests_yet', { v: filter === 'all' ? '' : `${filter} ` }) }}
      />

      {acting?.mode === 'view' ? (
        <Sheet visible onClose={() => setActing(null)} title={acting.request.business_name} subtitle={tr('admin.PaymentRequestsScreen.payment_claim')} width={760}>
          <RequestCard request={acting.request} planName={planName(acting.request.plan_key)} canEdit={canEdit}
            onApprove={() => setActing({ request: acting.request, mode: 'approve' })} onReject={() => setActing({ request: acting.request, mode: 'reject' })} />
        </Sheet>
      ) : null}
      {acting?.mode === 'approve' ? (
        <ApproveSheet request={acting.request} planName={planName(acting.request.plan_key)} onClose={() => setActing(null)} onDone={() => done(acting.request.id)} />
      ) : null}
      {acting?.mode === 'reject' ? (
        <RejectSheet request={acting.request} onClose={() => setActing(null)} onDone={() => done(acting.request.id)} />
      ) : null}
    </AdminListFrame>
  );
}

function RequestCard({ request: r, planName, canEdit, onApprove, onReject }: {
  request: PaymentRequest; planName: string; canEdit: boolean; onApprove: () => void; onReject: () => void;
}) {
  const { colors, radius } = useTheme();
  const { width } = useLayout();
  const online = useOnline();
  const wide = width >= 900;
  const diff = mismatch(r);
  const pending = r.status === 'pending';

  const amountBlock = (
    <View style={{ gap: 6, minWidth: wide ? 220 : undefined }}>
      <Text variant="caption" tone="subtle">{tr('admin.PaymentRequestsScreen.claimed_2')}</Text>
      <Text variant="moneyLarge">{money(r.amount)}</Text>
      {pending && r.expected_amount !== undefined ? (
        diff === null ? (
          <Badge label={tr('admin.PaymentRequestsScreen.matches_the_price')} tone="success" icon="checkmark" style={{ alignSelf: 'flex-start' }} />
        ) : (
          <View style={{ gap: 4 }}>
            <Badge label={tr('admin.PaymentRequestsScreen.expected_money', { money: money(r.expected_amount) })} tone="warning" icon="warning-outline" style={{ alignSelf: 'flex-start' }} />
            <Text variant="small" tone="warning">{diff > 0 ? tr('admin.PaymentRequestsScreen.money_more', { money: money(diff) }) : tr('admin.PaymentRequestsScreen.money_less', { money: money(-diff) })} {tr('admin.PaymentRequestsScreen.than_the_plan_price')}</Text>
          </View>
        )
      ) : null}
      {pending && canEdit ? (
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
          <Button title={tr('admin.PaymentRequestsScreen.approve')} icon="checkmark" variant="success" size="sm" onPress={onApprove} disabled={!online} />
          <Button title={tr('admin.PaymentRequestsScreen.reject')} icon="close" variant="secondary" size="sm" onPress={onReject} disabled={!online} />
        </View>
      ) : null}
    </View>
  );

  return (
    <Card style={{ gap: 12 }}>
      <View style={{ flexDirection: wide ? 'row' : 'column', gap: wide ? 24 : 14 }}>
        <View style={{ flex: wide ? 1 : undefined, minWidth: 0, gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Pressable onPress={() => goTo(`/admin/businesses/${r.business_id}`)} accessibilityRole="link" accessibilityLabel={tr('admin.PaymentRequestsScreen.open_business_name', { business_name: r.business_name })}
              style={({ hovered }: any) => [{ flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 }, hovered && { opacity: 0.75 },
                Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}>
              <Text variant="h3" numberOfLines={1} style={{ flexShrink: 1 }}>{r.business_name}</Text>
              <Ionicons name="open-outline" size={16} color={colors.textSubtle} />
            </Pressable>
            <Badge label={STATUS_LABEL[r.status] ?? r.status} tone={STATUS_TONE[r.status] ?? 'neutral'} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <Badge label={planName} tone="primary" icon="pricetag-outline" />
            <Text variant="small" tone="muted">{monthsText(r.months)}</Text>
            {r.offer_code ? <Badge label={r.offer_code} tone="accent" icon="gift-outline" /> : null}
            <Text variant="small" tone="subtle">{tr('admin.PaymentRequestsScreen.ago_ago', { ago: ago(r.created_at) })}</Text>
          </View>
          {pending && r.offer_error ? (
            <Callout tone="warning" title={tr('admin.PaymentRequestsScreen.offer_v_can_t_be_used_now', { v: r.offer_code ?? '' })}>
              {tr('admin.PaymentRequestsScreen.offer_error_you_can_approve_it_without', { offer_error: r.offer_error })}
            </Callout>
          ) : null}
          <View style={{ gap: 2 }}>
            <KeyValue label={tr('admin.PaymentRequestsScreen.reference')} value={r.reference || '—'} mono={!!r.reference}
              right={r.reference ? <Button icon="copy-outline" size="sm" variant="ghost" accessibilityLabel={tr('admin.PaymentRequestsScreen.copy_reference')} onPress={() => copyText(r.reference!, 'Reference')} /> : undefined} />
            <KeyValue label={tr('admin.PaymentRequestsScreen.method')} value={PAYMENT_METHOD_LABEL[r.method] ?? r.method} />
            <KeyValue label={tr('admin.PaymentRequestsScreen.sent_by')} value={r.requested_by ?? '—'} />
            <KeyValue label={tr('admin.PaymentRequestsScreen.sent_at')} value={formatDateTime(r.created_at)} />
          </View>
          {r.note ? (
            <View style={{ padding: 10, paddingHorizontal: 12, borderRadius: radius.md, backgroundColor: colors.surfaceSunken, flexDirection: 'row', gap: 8 }}>
              <Ionicons name="chatbubble-ellipses-outline" size={16} color={colors.textMuted} style={{ marginTop: 2 }} />
              <Text variant="small" style={{ flex: 1 }} selectable>{r.note}</Text>
            </View>
          ) : null}
          {r.status !== 'pending' ? (
            <Text variant="small" tone="muted">
              {r.status === 'approved' ? tr('admin.PaymentRequestsScreen.approved') : tr('admin.PaymentRequestsScreen.rejected')}{r.reviewed_by ? tr('admin.PaymentRequestsScreen.by_reviewed_by', { reviewed_by: r.reviewed_by }) : ''}{r.reviewed_at ? ` · ${formatDateTime(r.reviewed_at)}` : ''}
              {r.review_note ? ` · “${r.review_note}”` : ''}
            </Text>
          ) : null}
        </View>
        {wide ? <View style={{ width: 1, backgroundColor: colors.divider }} /> : null}
        {amountBlock}
      </View>
    </Card>
  );
}

function ApproveSheet({ request: r, planName, onClose, onDone }: { request: PaymentRequest; planName: string; onClose: () => void; onDone: () => void }) {
  const online = useOnline();
  const [amount, setAmount] = useState(String(r.amount));
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  /** The claimed offer ended / is used up: approve without it (at the amount that arrived) */
  const [withoutOffer, setWithoutOffer] = useState(!!r.offer_error);
  const amountNum = Number(amount.trim());
  const amountError = amount.trim() === '' || !Number.isFinite(amountNum) || amountNum < 0 ? 'Enter the amount that arrived.' : amountNum > 10_000_000 ? 'Too large.' : undefined;
  const diff = mismatch(r);

  const submit = async () => {
    if (amountError) return;
    setSaving(true);
    setFormError(null);
    try {
      const res = await platformApi.approvePaymentRequest(r.id, { amount_paid: amountNum, note: note.trim() || null, ...(r.offer_code && withoutOffer ? { ignore_offer: true } : {}) });
      toast.success(tr('admin.PaymentRequestsScreen.business_name_is_switched_on_paid_until', { business_name: r.business_name, toLocaleDateString: new Date(res.paid_until).toLocaleDateString(currentLocale(), { day: 'numeric', month: 'short', year: 'numeric' }) }));
      onDone();
    } catch (e) {
      setFormError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet visible onClose={onClose} title={tr('admin.PaymentRequestsScreen.approve_payment')} subtitle={`${r.business_name} · ${planName} · ${monthsText(r.months)}`} width={560}
      footer={
        <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'flex-end' }}>
          <Button title={tr('common.cancel')} variant="secondary" onPress={onClose} disabled={saving} />
          <Button title={tr('admin.PaymentRequestsScreen.approve_switch_on')} icon="checkmark" variant="success" onPress={submit} loading={saving} disabled={!online || !!amountError} />
        </View>
      }>
      {formError ? <Callout tone="danger">{formError}</Callout> : null}
      {r.offer_code ? (
        <View style={{ gap: 6 }}>
          {r.offer_error ? <Callout tone="warning" title={tr('admin.PaymentRequestsScreen.offer_offer_code_can_t_be_used_now', { offer_code: r.offer_code })}>{tr('admin.PaymentRequestsScreen.offer_error_approve_without_the_offer_at', { offer_error: r.offer_error })}</Callout> : null}
          <Segmented value={withoutOffer ? 'without' : 'with'} onChange={(v) => setWithoutOffer(v === 'without')}
            options={[{ value: 'with', label: tr('admin.PaymentRequestsScreen.with_offer_offer_code', { offer_code: r.offer_code }) }, { value: 'without', label: tr('admin.PaymentRequestsScreen.without_the_offer') }]} />
        </View>
      ) : null}
      <Callout tone="info">
        {tr('admin.PaymentRequestsScreen.records_monthstext_of_planname_v_from_the', { monthsText: monthsText(r.months), planName, v: r.offer_code && !withoutOffer ? tr('admin.PaymentRequestsScreen.with_offer_offer_code_2', { offer_code: r.offer_code }) : '' })}
      </Callout>
      <Card style={{ gap: 2 }}>
        <KeyValue label={tr('admin.PaymentRequestsScreen.claimed')} value={money(r.amount)} />
        {r.expected_amount !== undefined ? <KeyValue label={tr('admin.PaymentRequestsScreen.plan_price')} value={money(r.expected_amount)} /> : null}
        <KeyValue label={tr('admin.PaymentRequestsScreen.reference')} value={r.reference || '—'} mono={!!r.reference} />
      </Card>
      {diff !== null ? <Callout tone="warning">{tr('admin.PaymentRequestsScreen.the_claim_is_money_v_than_the_plan_price', { money: money(Math.abs(diff)), v: diff > 0 ? 'more' : 'less' })}</Callout> : null}
      <Input label={tr('admin.PaymentRequestsScreen.amount_received')} required prefix="₹" value={amount} onChangeText={(v) => setAmount(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad"
        maxLength={11} error={amountError} hint={tr('admin.PaymentRequestsScreen.what_actually_reached_brand_s_account', { brand: brand.name })} />
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Button title={tr('admin.PaymentRequestsScreen.claimed_money', { money: money(r.amount) })} size="sm" variant={amountNum === r.amount ? 'soft' : 'secondary'} onPress={() => setAmount(String(r.amount))} />
        {r.expected_amount !== undefined && diff !== null ? (
          <Button title={tr('admin.PaymentRequestsScreen.plan_price_money', { money: money(r.expected_amount) })} size="sm" variant={amountNum === r.expected_amount ? 'soft' : 'secondary'}
            onPress={() => setAmount(String(r.expected_amount))} />
        ) : null}
      </View>
      <Input label={tr('admin.PaymentRequestsScreen.note_optional')} value={note} onChangeText={setNote} maxLength={300} placeholder={tr('admin.PaymentRequestsScreen.e_g_upi_credit_checked_in_the_bank_app')} />
    </Sheet>
  );
}

const REJECT_REASONS = ['Payment not received yet', 'Reference number not found', "Amount doesn't match the plan", 'Paid to the wrong account'];

function RejectSheet({ request: r, onClose, onDone }: { request: PaymentRequest; onClose: () => void; onDone: () => void }) {
  const online = useOnline();
  const [reason, setReason] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const error = submitted && reason.trim().length < 3 ? tr('admin.PaymentRequestsScreen.tell_the_owner_why_at_least_3_characters') : undefined;

  const submit = async () => {
    setSubmitted(true);
    if (reason.trim().length < 3) return;
    setSaving(true);
    setFormError(null);
    try {
      await platformApi.rejectPaymentRequest(r.id, reason.trim());
      toast.success(tr('admin.PaymentRequestsScreen.claim_from_business_name_rejected', { business_name: r.business_name }));
      onDone();
    } catch (e) {
      setFormError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet visible onClose={onClose} title={tr('admin.PaymentRequestsScreen.reject_payment_claim')} subtitle={`${r.business_name} · ${money(r.amount)}${r.reference ? ` · ${r.reference}` : ''}`} width={540}
      footer={
        <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'flex-end' }}>
          <Button title={tr('common.cancel')} variant="secondary" onPress={onClose} disabled={saving} />
          <Button title={tr('admin.PaymentRequestsScreen.reject_claim')} icon="close" variant="danger" onPress={submit} loading={saving} disabled={!online} />
        </View>
      }>
      {formError ? <Callout tone="danger">{formError}</Callout> : null}
      <Callout tone="warning">{tr('admin.PaymentRequestsScreen.the_business_stays_as_it_is_locked_if_its')}</Callout>
      <Input label={tr('admin.PaymentRequestsScreen.reason_shown_to_the_owner')} required value={reason} onChangeText={setReason} maxLength={300} error={error} autoFocus
        placeholder={tr('admin.PaymentRequestsScreen.e_g_we_couldn_t_find_this_utr_in_our')} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {REJECT_REASONS.map((t) => <Button key={t} title={t} size="sm" variant={reason === t ? 'soft' : 'secondary'} onPress={() => setReason(t)} />)}
      </View>
    </Sheet>
  );
}
