/**
 * Business records: search a business's bills and archive, restore or permanently delete them. Businesses can never delete
 * their own records; only a Storant super admin can, usually when the owner asks. Archiving is preferred: the bill leaves
 * lists and reports but stays in the database, the GST invoice series stays continuous, and it can be undone.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { errorMessage } from '@/api/client';
import { platformApi, type AdminBill, type BillStatus, type RecordsAction } from '@/api/platform';
import { Badge, Button, Card, Chip, Divider, EmptyState, ErrorState, Input, Loading, Sheet, Text, toast } from '@/components/ui';
import { useApi } from '@/hooks/useApi';
import { formatDateTime, money } from '@/lib/format';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { Callout, monoFont } from '@/features/settings/components';
import { BILL_STATUS_LABEL, BILL_STATUS_TONE, plural, useOnline } from './shared';
import { t } from '@/i18n';

function useDebounced<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function billsSummary(bills: AdminBill[]): string {
  const total = bills.reduce((n, b) => n + (Number(b.total) || 0), 0);
  const invoices = bills.filter((b) => b.invoice_no).length;
  return `${plural(bills.length, 'bill')} · ${money(total)}${invoices ? ` · ${plural(invoices, 'tax invoice')}` : ''}`;
}

function Checkbox({ checked, onToggle, label }: { checked: boolean; onToggle: () => void; label: string }) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onToggle} accessibilityRole="checkbox" accessibilityState={{ checked }} accessibilityLabel={label} hitSlop={8}
      style={[{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }, Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}>
      <Ionicons name={checked ? 'checkbox' : 'square-outline'} size={22} color={checked ? colors.primary : colors.textSubtle} />
    </Pressable>
  );
}

/** One bill line; with `onToggle` it is selectable. */
export function BillRow({ bill: b, selected, onToggle, first }: { bill: AdminBill; selected?: boolean; onToggle?: () => void; first?: boolean }) {
  const { colors } = useTheme();
  const { width } = useLayout();
  const wide = width >= 900;
  const status = (
    <View style={{ flexDirection: 'row', gap: 4, flexWrap: 'wrap' }}>
      <Badge label={BILL_STATUS_LABEL[b.status] ?? b.status} tone={BILL_STATUS_TONE[b.status] ?? 'neutral'} />
      {b.archived ? <Badge label={t('admin.BusinessRecords.archived')} tone="warning" icon="archive-outline" /> : null}
    </View>
  );
  const body = wide ? (
    <>
      <View style={{ flex: 1.3, minWidth: 0, gap: 2 }}>
        <Text variant="bodyStrong" numberOfLines={1} style={{ fontFamily: monoFont }}>{b.invoice_no ?? `#${b.code}`}</Text>
        <Text variant="caption" tone="subtle" numberOfLines={1}>{b.invoice_no ? `#${b.code} · ` : ''}{b.channel ?? 'POS'}</Text>
      </View>
      <Text variant="small" tone={b.customer_name ? 'default' : 'subtle'} numberOfLines={1} style={{ flex: 1 }}>{b.customer_name ?? t('admin.BusinessRecords.walk_in')}</Text>
      <View style={{ flex: 1 }}>{status}</View>
      <Text variant="small" tone="muted" numberOfLines={1} style={{ flex: 1 }}>{formatDateTime(b.created_at)}</Text>
      <Text variant="bodyStrong" style={{ width: 100, textAlign: 'right' }}>{money(b.total)}</Text>
    </>
  ) : (
    <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text variant="bodyStrong" numberOfLines={1} style={{ flex: 1, fontFamily: monoFont }}>{b.invoice_no ?? `#${b.code}`}</Text>
        <Text variant="bodyStrong">{money(b.total)}</Text>
      </View>
      <Text variant="small" tone="muted" numberOfLines={1}>{b.customer_name ?? t('admin.BusinessRecords.walk_in')} · {formatDateTime(b.created_at)}</Text>
      {status}
    </View>
  );
  return (
    <Pressable onPress={onToggle} disabled={!onToggle} accessibilityRole={onToggle ? 'checkbox' : undefined} accessibilityState={onToggle ? { checked: !!selected } : undefined}
      style={({ hovered }: any) => [
        { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10, minHeight: 52,
          borderTopWidth: first ? 0 : 1, borderTopColor: colors.divider },
        selected ? { backgroundColor: colors.primarySoft } : hovered && onToggle ? { backgroundColor: colors.surfaceSunken } : null,
        Platform.OS === 'web' && onToggle ? ({ cursor: 'pointer' } as any) : null,
      ]}>
      {onToggle ? (
        <View style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }} accessibilityElementsHidden importantForAccessibility="no">
          <Ionicons name={selected ? 'checkbox' : 'square-outline'} size={22} color={selected ? colors.primary : colors.textSubtle} />
        </View>
      ) : null}
      {body}
    </Pressable>
  );
}

/** Warning + "type DELETE" field used before any permanent deletion. */
export function DeleteConfirm({ bills, typed, onTyped, onArchiveInstead, error }: {
  bills: AdminBill[]; typed: string; onTyped: (v: string) => void; onArchiveInstead?: () => void; error?: string;
}) {
  const invoices = bills.filter((b) => b.invoice_no).length;
  return (
    <View style={{ gap: 12 }}>
      <Callout tone="danger" icon="trash-outline" title={t('admin.BusinessRecords.permanent_this_can_t_be_undone')}
        action={onArchiveInstead ? <Button title={t('admin.BusinessRecords.archive_instead')} icon="archive-outline" size="sm" variant="secondary" onPress={onArchiveInstead} /> : undefined}>
        <Text variant="small">
          {t('admin.BusinessRecords.the_bill_v_items_payments_and_kitchen', { v: bills.length === 1 ? '' : 's' })}
        </Text>
      </Callout>
      <Callout tone="warning" icon="document-text-outline" title={invoices ? t('admin.BusinessRecords.plural_in_this_selection', { plural: plural(invoices, 'tax invoice') }) : t('admin.BusinessRecords.archiving_is_preferred_for_gst')}>
        {invoices
          ? t('admin.BusinessRecords.deleting_tax_invoices_leaves_gaps_in_the')
          : t('admin.BusinessRecords.archived_bills_disappear_from_lists_and')}
      </Callout>
      <Input label={t('common.type_delete_to_confirm')} required value={typed} onChangeText={(v) => onTyped(v.toUpperCase())} autoCapitalize="characters" autoCorrect={false}
        maxLength={6} placeholder={t('common.delete')} error={error} accessibilityLabel={t('common.type_delete_to_confirm')} />
    </View>
  );
}

const ACTION_COPY: Record<RecordsAction, { title: string; button: string; icon: keyof typeof Ionicons.glyphMap; done: string }> = {
  archive: { get title() { return t('common.archive_bills'); }, button: 'Archive', icon: 'archive-outline', done: 'archived' },
  unarchive: { get title() { return t('admin.BusinessRecords.restore_archived_bills'); }, button: 'Restore', icon: 'arrow-undo-outline', done: 'restored' },
  delete: { get title() { return t('admin.BusinessRecords.delete_bills_permanently'); }, button: 'Delete permanently', icon: 'trash-outline', done: 'deleted' },
};

export function RecordsActionSheet({ businessId, businessName, bills, action: initial, onClose, onDone }: {
  businessId: string; businessName: string; bills: AdminBill[]; action: RecordsAction; onClose: () => void; onDone: () => void;
}) {
  const online = useOnline();
  const [action, setAction] = useState<RecordsAction>(initial);
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const targets = action === 'archive' ? bills.filter((b) => !b.archived) : action === 'unarchive' ? bills.filter((b) => b.archived) : bills;
  const running = targets.filter((b) => b.status === 'open' || b.status === 'placed').length;
  const copy = ACTION_COPY[action];
  const errors = {
    reason: reason.trim().length < 3 ? 'Give a reason (at least 3 characters). It is kept in the audit log.' : undefined,
    typed: action === 'delete' && typed !== 'DELETE' ? 'Type DELETE in capitals.' : undefined,
  };

  const submit = async () => {
    setSubmitted(true);
    setFormError(null);
    if (errors.reason || errors.typed || !targets.length) return;
    setSaving(true);
    try {
      const r = await platformApi.billsAction(businessId, action, {
        order_ids: targets.map((b) => b.id), reason: reason.trim(), ...(action === 'delete' ? { confirm: 'DELETE' as const } : {}),
      });
      const n = r[action] ?? targets.length;
      toast.success(`${plural(n, 'bill')} ${copy.done}`);
      if (r.warning) toast.warning(r.warning);
      onDone();
    } catch (e) {
      setFormError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet visible onClose={onClose} title={copy.title} subtitle={`${businessName} · ${billsSummary(targets)}`} width={640}
      footer={
        <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'flex-end' }}>
          <Button title={t('common.cancel')} variant="secondary" onPress={onClose} disabled={saving} />
          <Button title={copy.button} icon={copy.icon} variant={action === 'delete' ? 'danger' : 'primary'} onPress={submit} loading={saving}
            disabled={!online || !targets.length || (action === 'delete' && typed !== 'DELETE')} />
        </View>
      }>
      {formError ? <Callout tone="danger">{formError}</Callout> : null}
      {action === 'archive' ? (
        <Callout tone="info" icon="archive-outline">
          {t('admin.BusinessRecords.archived_bills_disappear_from_the', { v: running ? t('admin.BusinessRecords.plural_will_be_cancelled_first_frees_the', { plural: plural(running, 'running bill') }) : '' })}
        </Callout>
      ) : null}
      {action === 'unarchive' ? <Callout tone="info">{t('admin.BusinessRecords.the_bills_show_again_in_the_business_s')}</Callout> : null}
      {action === 'delete' ? (
        <DeleteConfirm bills={targets} typed={typed} onTyped={setTyped} error={submitted ? errors.typed : undefined}
          onArchiveInstead={bills.some((b) => !b.archived) ? () => { setAction('archive'); setTyped(''); } : undefined} />
      ) : null}
      {!targets.length ? <Callout tone="warning">{t('admin.BusinessRecords.none_of_the_selected_bills_can_be_done', { done: copy.done })}</Callout> : null}
      <Input label={t('common.reason')} required value={reason} onChangeText={setReason} maxLength={200} error={submitted ? errors.reason : undefined}
        placeholder={action === 'delete' ? t('admin.BusinessRecords.e_g_owner_request_test_bills_from_training') : t('admin.BusinessRecords.e_g_duplicate_bill_entered_by_mistake')} />
      <Card padded={false} style={{ overflow: 'hidden' }}>
        <ScrollView style={{ maxHeight: 260 }} nestedScrollEnabled>
          {targets.map((b, i) => <BillRow key={b.id} bill={b} first={i === 0} />)}
        </ScrollView>
      </Card>
    </Sheet>
  );
}

type StatusFilter = 'all' | BillStatus;
const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', get label() { return t('common.all'); } }, { value: 'completed', get label() { return t('common.paid'); } }, { value: 'open', get label() { return t('common.running'); } }, { value: 'cancelled', get label() { return t('common.cancelled'); } },
];

/** "Records" section of the business page. */
export function RecordsCard({ businessId, businessName, editable }: { businessId: string; businessName: string; editable: boolean }) {
  const { isPhone } = useLayout();
  const online = useOnline();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [archived, setArchived] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [acting, setActing] = useState<RecordsAction | null>(null);
  const q = useDebounced(query.trim());
  const bills = useApi(() => platformApi.businessBills(businessId, { q, status: status === 'all' ? null : status, include_archived: archived, limit: 100 }),
    [businessId, q, status, archived]);
  const rows = bills.data ?? [];
  const picked = useMemo(() => rows.filter((b) => selected.has(b.id)), [rows, selected]);
  const pickedArchived = picked.filter((b) => b.archived).length;

  useEffect(() => setSelected(new Set()), [q, status, archived]);

  const toggle = (id: string) => setSelected((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const allPicked = rows.length > 0 && picked.length === rows.length;

  return (
    <Card style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="h3" accessibilityRole="header">{t('admin.BusinessRecords.records')}</Text>
          <Text variant="small" tone="muted">{t('admin.BusinessRecords.the_business_can_t_delete_bills_itself')}</Text>
        </View>
      </View>
      <Input value={query} onChangeText={setQuery} icon="search" placeholder={t('admin.BusinessRecords.bill_number_invoice_number_or_customer')} autoCapitalize="none" autoCorrect={false}
        maxLength={60} accessibilityLabel={t('admin.BusinessRecords.search_bills')}
        right={query ? <Button icon="close" size="sm" variant="ghost" accessibilityLabel={t('common.clear_search')} onPress={() => setQuery('')} /> : undefined} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, alignItems: 'center' }}>
        {STATUS_FILTERS.map((s) => <Chip key={s.value} label={s.label} selected={status === s.value} onPress={() => setStatus(s.value)} />)}
        <Chip label={t('admin.BusinessRecords.include_archived')} icon={archived ? 'checkmark' : 'archive-outline'} selected={archived} onPress={() => setArchived((v) => !v)} />
      </ScrollView>

      {editable && picked.length ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Text variant="smallStrong" style={{ flex: 1, minWidth: 160 }}>{billsSummary(picked)} {t('admin.BusinessRecords.selected')}</Text>
          {picked.length > pickedArchived ? <Button title={t('admin.BusinessRecords.archive')} icon="archive-outline" size="sm" variant="secondary" onPress={() => setActing('archive')} disabled={!online} /> : null}
          {pickedArchived ? <Button title={t('admin.BusinessRecords.restore')} icon="arrow-undo-outline" size="sm" variant="secondary" onPress={() => setActing('unarchive')} disabled={!online} /> : null}
          <Button title={isPhone ? t('common.delete_2') : t('admin.BusinessRecords.delete_permanently')} icon="trash-outline" size="sm" variant="danger" onPress={() => setActing('delete')} disabled={!online} />
          <Button title={t('common.clear')} size="sm" variant="ghost" onPress={() => setSelected(new Set())} />
        </View>
      ) : null}

      {bills.loading && !bills.data ? <Loading label={t('admin.BusinessRecords.loading_bills')} /> : null}
      {bills.error && !bills.data ? <ErrorState message={bills.error} onRetry={bills.reload} /> : null}
      {bills.data && rows.length === 0 ? (
        <EmptyState icon="receipt-outline" title={q || status !== 'all' ? t('admin.BusinessRecords.no_bills_match') : t('admin.BusinessRecords.no_bills_yet')} message={q ? t('admin.BusinessRecords.try_a_different_number_or_name') : undefined} />
      ) : null}
      {rows.length ? (
        <Card padded={false} style={{ overflow: 'hidden' }}>
          {editable ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 4 }}>
              <Checkbox checked={allPicked} label={t('admin.BusinessRecords.select_all_shown')} onToggle={() => setSelected(allPicked ? new Set() : new Set(rows.map((b) => b.id)))} />
              <Text variant="small" tone="muted">{allPicked ? t('admin.BusinessRecords.all_shown_selected') : t('admin.BusinessRecords.select_all_length_shown', { length: rows.length })}</Text>
            </View>
          ) : null}
          {editable ? <Divider /> : null}
          {rows.map((b, i) => (
            <BillRow key={b.id} bill={b} first={i === 0} selected={selected.has(b.id)} onToggle={editable ? () => toggle(b.id) : undefined} />
          ))}
        </Card>
      ) : null}
      {rows.length >= 100 ? <Text variant="small" tone="subtle">{t('admin.BusinessRecords.showing_the_latest_100_search_to_find')}</Text> : null}

      {acting && picked.length ? (
        <RecordsActionSheet businessId={businessId} businessName={businessName} bills={picked} action={acting} onClose={() => setActing(null)}
          onDone={() => { setActing(null); setSelected(new Set()); void bills.silentReload(); }} />
      ) : null}
    </Card>
  );
}

