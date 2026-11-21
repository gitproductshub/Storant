/**
 * Requests to Storant: the business can never archive or delete its own records; the owner asks and Storant's
 * super admin does it (or explains why not). The reply shows up in "Your requests".
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ownerApi, type OwnerRequest, type OwnerRequestKind, type WatchCancelledBill } from '@/api/owner';
import { errorMessage } from '@/api/client';
import type { Order } from '@/api/types';
import { Badge, Button, Card, Chip, Divider, Input, Loading, Segmented, Sheet, Text, toast, type BadgeTone } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { formatDate, formatDateTime, money } from '@/lib/format';
import { plural } from './watchUtils';
import { brand } from '@/config/brand';
import { t as tr } from '@/i18n';

const KIND_LABEL: Record<OwnerRequestKind, string> = {
  get archive_bills() { return tr('common.archive_bills'); },
  get delete_bills() { return tr('owner.AskStorant.delete_bills'); },
  get other() { return tr('common.other'); },
};

const KIND_HELP: Record<OwnerRequestKind, string> = {
  archive_bills: `${brand.name} hides these bills from your everyday lists and reports (for example test bills). They stay in the records.`,
  delete_bills: `${brand.name} checks the request first. Tax invoices usually have to be kept for several years, so ${brand.name} may archive them instead.`,
  other: `Tell ${brand.name} what looks wrong, for example a bill that was cancelled by mistake.`,
};

interface PickBill { id: string; bill: string; total: number; at: string | null; note: string }

function fromCancelled(b: WatchCancelledBill): PickBill {
  return { id: b.id, bill: b.bill, total: b.total, at: b.cancelled_at, note: `Cancelled${b.by ? ` by ${b.by}` : ''}${b.reason ? ` · ${b.reason}` : ''}` };
}

function fromOrder(o: Order): PickBill {
  const status = o.status === 'cancelled' ? 'Cancelled' : o.status === 'completed' ? 'Paid' : 'Open';
  return { id: o.id, bill: o.invoice_no || o.code, total: o.total_amount, at: o.created_at,
    note: `${status}${(o as Order & { archived?: boolean }).archived ? ' · archived' : ''}` };
}

export function AskStorantSheet({ visible, onClose, cancelled, symbol, onSent }: {
  visible: boolean; onClose: () => void; cancelled: WatchCancelledBill[]; symbol: string; onSent: (r: OwnerRequest) => void;
}) {
  const { colors } = useTheme();
  const [kind, setKind] = useState<OwnerRequestKind>('archive_bills');
  const [source, setSource] = useState<'cancelled' | 'recent'>('cancelled');
  const [selected, setSelected] = useState<Record<string, PickBill>>({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [recent, setRecent] = useState<PickBill[] | null>(null);
  const [recentError, setRecentError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setKind('archive_bills');
    setSource(cancelled.length ? 'cancelled' : 'recent');
    setSelected({});
    setMessage('');
    setError(null);
    setSearch('');
  }, [visible, cancelled.length]);

  useEffect(() => {
    if (!visible || source !== 'recent') return undefined;
    let live = true;
    const t = setTimeout(async () => {
      setRecentError(null);
      try {
        const res = await ownerApi.bills({ q: search.trim() || undefined, limit: 50 });
        if (live) setRecent(res.items.map(fromOrder));
      } catch (e) {
        if (live) setRecentError(errorMessage(e));
      }
    }, search ? 350 : 0);
    return () => { live = false; clearTimeout(t); };
  }, [visible, source, search]);

  const list = useMemo(() => (source === 'cancelled' ? cancelled.map(fromCancelled) : recent ?? []), [source, cancelled, recent]);
  const needsBills = kind !== 'other';
  const chosen = Object.values(selected);
  const trimmed = message.trim();
  const problem = needsBills && !chosen.length ? 'Choose the bills' : trimmed.length < 5 ? 'Write a short message (at least 5 characters)' : null;

  const toggle = (b: PickBill) => setSelected((s) => {
    const next = { ...s };
    if (next[b.id]) delete next[b.id]; else next[b.id] = b;
    return next;
  });

  const send = async () => {
    if (problem) { setError(problem); return; }
    setBusy(true);
    setError(null);
    try {
      const row = await ownerApi.ask({ kind, order_ids: needsBills ? chosen.map((b) => b.id) : [], message: trimmed });
      toast.success(tr('owner.AskStorant.sent_to_brand_you_will_see_the_reply_here', { brand: brand.name }));
      onSent(row);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} width={640} title={tr('owner.AskStorant.ask_brand', { brand: brand.name })}
      subtitle={tr('owner.AskStorant.nobody_in_your_business_can_archive_or', { brand: brand.name })}
      footer={(
        <View style={styles.footer}>
          <Text variant="small" tone={error ? 'danger' : 'subtle'} style={{ flex: 1, minWidth: 160 }}>
            {error ?? (needsBills ? (chosen.length ? tr('owner.AskStorant.plural_selected', { plural: plural(chosen.length, 'bill') }) : tr('owner.AskStorant.no_bills_selected_yet')) : ' ')}
          </Text>
          <Button title={tr('common.cancel')} variant="ghost" onPress={onClose} disabled={busy} />
          <Button title={tr('owner.AskStorant.send_to_brand', { brand: brand.name })} icon="send" onPress={send} loading={busy} disabled={busy} />
        </View>
      )}>
      <View style={{ gap: 14 }}>
        <Segmented value={kind} onChange={(k) => { setKind(k); setError(null); }}
          options={(Object.keys(KIND_LABEL) as OwnerRequestKind[]).map((k) => ({ value: k, label: KIND_LABEL[k] }))} />
        <Text variant="small" tone="muted">{KIND_HELP[kind]}</Text>

        {needsBills ? (
          <View style={{ gap: 10 }}>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              <Chip label={tr('owner.AskStorant.cancelled_in_this_period')} count={cancelled.length} selected={source === 'cancelled'} onPress={() => setSource('cancelled')} />
              <Chip label={tr('owner.AskStorant.all_recent_bills')} icon="search" selected={source === 'recent'} onPress={() => setSource('recent')} />
            </View>
            {source === 'recent' ? (
              <Input value={search} onChangeText={setSearch} placeholder={tr('owner.AskStorant.bill_number_customer_name_or_phone')} icon="search" autoCorrect={false} />
            ) : null}
            <Card padded={false} style={{ maxHeight: 300, overflow: 'hidden' }}>
              {source === 'recent' && recent === null && !recentError ? <Loading label={tr('owner.AskStorant.loading_bills')} /> : null}
              {source === 'recent' && recentError ? <Text tone="danger" style={{ padding: 16 }}>{recentError}</Text> : null}
              {list.length === 0 && (source === 'cancelled' || recent !== null) ? (
                <Text tone="subtle" style={{ padding: 16 }}>
                  {source === 'cancelled' ? tr('owner.AskStorant.no_cancelled_bills_in_this_period_look_in') : tr('owner.AskStorant.no_bills_found')}
                </Text>
              ) : null}
              <View>
                {list.map((b, i) => {
                  const on = !!selected[b.id];
                  return (
                    <View key={b.id}>
                      {i ? <Divider /> : null}
                      <Pressable onPress={() => toggle(b)} accessibilityRole="checkbox" accessibilityState={{ checked: on }}
                        accessibilityLabel={tr('owner.AskStorant.bill_bill', { bill: b.bill })}
                        style={({ hovered }: any) => [styles.pick, (hovered || on) && { backgroundColor: on ? colors.primarySoft : colors.surfaceSunken },
                          Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}>
                        <Ionicons name={on ? 'checkbox' : 'square-outline'} size={22} color={on ? colors.primary : colors.textSubtle} />
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text variant="bodyStrong" numberOfLines={1}>{b.bill}</Text>
                          <Text variant="small" tone="muted" numberOfLines={1}>{[formatDateTime(b.at), b.note].filter(Boolean).join(' · ')}</Text>
                        </View>
                        <Text variant="money">{money(b.total, symbol)}</Text>
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            </Card>
          </View>
        ) : null}

        <Input label={tr('owner.AskStorant.message_to_brand', { brand: brand.name })} required value={message} onChangeText={(v) => { setMessage(v); if (error) setError(null); }}
          multiline numberOfLines={3} maxLength={1000} style={{ minHeight: 84, textAlignVertical: 'top' }}
          placeholder={kind === 'other' ? tr('owner.AskStorant.what_happened_and_what_should_be_corrected') : tr('owner.AskStorant.why_should_these_bills_be_archived_or')}
          hint={`${message.length}/1000`} />
      </View>
    </Sheet>
  );
}

const STATUS: Record<string, { label: string; tone: BadgeTone; icon: keyof typeof Ionicons.glyphMap }> = {
  pending: { get label() { return tr('owner.AskStorant.waiting_for_brand', { brand: brand.name }); }, tone: 'warning', icon: 'time-outline' },
  done: { get label() { return tr('common.done'); }, tone: 'success', icon: 'checkmark-circle' },
  rejected: { get label() { return tr('owner.AskStorant.not_done'); }, tone: 'neutral', icon: 'close-circle-outline' },
};

const ACTION_TAKEN: Record<string, string> = { archived: 'Bills archived', deleted: 'Bills deleted', none: 'No change made' };

export function RequestsCard({ requests, loading, error, onRetry, onAsk }: {
  requests: OwnerRequest[] | null; loading: boolean; error: string | null; onRetry: () => void; onAsk: () => void;
}) {
  const { colors, radius } = useTheme();
  return (
    <Card style={{ gap: 12 }}>
      <View style={styles.cardHead}>
        <View style={{ flex: 1, minWidth: 180 }}>
          <Text variant="h3">{tr('owner.AskStorant.your_requests_to')} {brand.name}</Text>
          <Text variant="small" tone="muted">{tr('owner.AskStorant.archiving_deleting_or_correcting_records', { brand: brand.name })}</Text>
        </View>
        <Button title={tr('owner.AskStorant.new_request')} size="sm" variant="secondary" icon="add" onPress={onAsk} />
      </View>
      {loading && !requests ? <Loading /> : null}
      {error && !requests ? (
        <View style={{ gap: 8 }}>
          <Text tone="danger" variant="small">{error}</Text>
          <Button title={tr('common.try_again')} size="sm" variant="ghost" icon="refresh" onPress={onRetry} style={{ alignSelf: 'flex-start' }} />
        </View>
      ) : null}
      {requests && requests.length === 0 ? (
        <Text tone="subtle" variant="small">{tr('owner.AskStorant.no_requests_yet_use_ask_brand_to_archive', { brand: brand.name })}</Text>
      ) : null}
      {(requests ?? []).map((r, i) => {
        const st = STATUS[r.status] ?? { label: r.status, tone: 'neutral' as BadgeTone, icon: 'help-circle-outline' as const };
        return (
          <View key={r.id} style={{ gap: 8 }}>
            {i ? <Divider /> : null}
            <View style={styles.reqHead}>
              <Text variant="bodyStrong">{KIND_LABEL[r.kind as OwnerRequestKind] ?? r.kind}</Text>
              <Badge label={st.label} tone={st.tone} icon={st.icon} />
              {r.status === 'done' && r.action_taken ? <Badge label={ACTION_TAKEN[r.action_taken] ?? r.action_taken} tone="info" /> : null}
              <View style={{ flex: 1 }} />
              <Text variant="small" tone="subtle">{formatDate(r.created_at)}</Text>
            </View>
            <Text variant="small" tone="muted">
              {r.order_ids.length ? `${plural(r.order_ids.length, 'bill')} · ` : ''}{r.message}
            </Text>
            {r.response ? (
              <View style={[styles.reply, { backgroundColor: colors.surfaceSunken, borderRadius: radius.md, borderLeftColor: colors.primary }]}>
                <Text variant="caption" tone="subtle">{brand.name.toUpperCase()} {tr('owner.AskStorant.replied')}{r.handled_at ? ` · ${formatDateTime(r.handled_at)}` : ''}</Text>
                <Text variant="small">{r.response}</Text>
              </View>
            ) : null}
          </View>
        );
      })}
    </Card>
  );
}

const styles = StyleSheet.create({
  footer: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  pick: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10, minHeight: 56 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  reqHead: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  reply: { padding: 12, gap: 4, borderLeftWidth: 3 },
});
