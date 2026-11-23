/**
 * Kitchen display (KDS) for a wall TV, a tablet without keyboard, or a phone (docs/20_High_Volume_UX.md):
 * - Big tickets in New / Preparing / Ready columns (tabs on narrow screens), oldest first.
 * - Time since the KOT on every ticket, amber after 10 min, red after 20.
 * - One tap per item moves it on up to Ready (long-press steps back); the big button moves the whole ticket: Start → Ready → Bump.
 * - Bump only clears a ready ticket off this screen: dine-in food stays Ready until the waiter serves it (the kitchen never
 *   marks Served). Takeaway / delivery / aggregator food, or every ticket when the owner turns on "Bump marks served",
 *   is served by the bump. Undo and Recall bring the ticket back.
 * - New tickets glow and beep (Web Audio, mute toggle remembered per device).
 * - Cancelled lines are struck through in red: "Don't make".
 * - Recall brings back recently bumped tickets. Filters by order type and brand.
 * - Optional keyboard: 1–9 select a ticket, Space bumps it, Esc clears.
 * Refreshes every 5 s while visible.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import {
  ActionMenu, Button, EmptyState, ErrorState, FilterBar, IconButton, Screen, Segmented, ShortcutHint, Skeleton, StatusPill, Text, toast, useHotkeys, useShowShortcuts,
  type ActionMenuItem,
} from '@/components/ui';
import { floorApi, type FloorTicket, type FloorTicketItem, type ItemStatus } from '@/api/floor';
import { errorMessage } from '@/api/client';
import { useData } from '@/store/data';
import { useBadges } from '@/store/badges';
import { kotFromTicket, printErrorMessage, printKitchenTicket } from '@/lib/billing';
import { ORDER_TYPE_UI } from '@/lib/uiLabels';
import { channelLabel } from './common';
import {
  ageTone, bumpTarget, formatAge, freshIds, kindCounts, minutesBetween, nextItemStep, prevItemStep, pruneMarks, ticketKind,
  ticketStatusFrom, type KitchenKindFilter, type TicketAction, type TicketStatus,
} from './floorLogic';
import { playAlert, useDevicePref, useLivePoll, useNow } from '@/hooks/live';
import { say, sayNow, useWakeLock, voiceAvailable, voiceNeedsTap } from '@/lib/voice';
import { VOICE_ON_LINE, newKotLine } from '@/lib/voiceLines';
import { useVoicePrefs } from '@/store/voicePrefs';
import { AgeChip, LiveStatus, ageColors } from './parts';
import { useFloorAges } from './useFloorAges';
import type { AgeThresholds } from './floorLogic';
import { t as tr } from '@/i18n';

type Column = 'pending' | 'preparing' | 'ready';
const COLUMNS: { key: Column; label: string; bump: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'pending', get label() { return tr('common.new'); }, bump: 'Start', icon: 'flame' },
  { key: 'preparing', get label() { return tr('common.preparing'); }, bump: 'Ready', icon: 'checkmark' },
  { key: 'ready', get label() { return tr('common.ready'); }, bump: 'Bump', icon: 'checkmark-done' },
];
const ACTIVE: TicketStatus[] = ['pending', 'preparing', 'ready'];
const STATUS_WORD: Record<TicketStatus, string> = { pending: 'new', preparing: 'preparing', ready: 'ready', served: 'served', cancelled: 'cancelled' };
const ITEM_WORD: Record<ItemStatus, string> = { pending: 'New', preparing: 'Cooking', ready: 'Ready', served: 'Served' };
const bumpWord = (a: TicketAction | null) => (a === 'bump' ? 'bumped' : a ? STATUS_WORD[a] : 'bumped');
const kotName = (t: FloorTicket) => String(t.kot_no ?? t.order_code);
const OVERRIDE_TTL = 15_000;
const POLL_MS = 5_000;
const NEW_GLOW_MS = 45_000;
const RECALL_KEEP_MS = 30 * 60_000;
const KIND_LABEL: Record<Exclude<KitchenKindFilter, 'all'>, string> = { get DINE_IN() { return tr('ops.KitchenScreen.dine_in'); }, get TAKEAWAY() { return tr('common.takeaway'); }, get DELIVERY() { return tr('common.delivery'); }, get SWIGGY() { return tr('ops.KitchenScreen.swiggy'); }, get ZOMATO() { return tr('ops.KitchenScreen.zomato'); } };

interface Override { ticket: FloorTicket; status: TicketStatus; at: number }
interface ItemOverride { status: ItemStatus; at: number }

export default function KitchenScreen() {
  const { colors } = useTheme();
  const { isPhone, isDesktop, width } = useLayout();
  const tabsMode = width < 1000;
  const showKeys = useShowShortcuts();
  const brandsInStore = useData((s) => s.brands);
  const now = useNow(10_000);
  const ages = useFloorAges();
  const poll = useLivePoll(() => floorApi.tickets('active'), [], POLL_MS);
  const { data, error, loading, reload, silentReload } = poll;

  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  const [itemOverrides, setItemOverrides] = useState<Record<string, ItemOverride>>({});
  const [itemBusy, setItemBusy] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [tab, setTab] = useState<Column>('pending');
  const [kind, setKind] = useState<KitchenKindFilter>('all');
  const [brand, setBrand] = useState<string | null>(null);
  const [large, setLarge] = useDevicePref<boolean>('kitchen.large', false);
  const [sound, setSound] = useDevicePref<boolean>('kitchen.sound', true);
  const [glow, setGlow] = useState<Record<string, number>>({});
  const [bumped, setBumped] = useState<{ ticket: FloorTicket; at: number }[]>([]);
  const [recallServer, setRecallServer] = useState<FloorTicket[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const seen = useRef<Set<string> | null>(null);
  // Voice (Hindi): "नया ऑर्डर आया है। टेबल 5।" — per device, Settings → Account → Voice alerts
  const kitchenVoice = useVoicePrefs((s) => s.kitchenVoice);
  const kitchenItems = useVoicePrefs((s) => s.kitchenItems);
  const setVoicePrefs = useVoicePrefs((s) => s.set);
  const canSpeak = voiceAvailable();
  const [voiceTapped, setVoiceTapped] = useState(false);
  useWakeLock(canSpeak && kitchenVoice); // the screen stays on while it listens for orders

  // New tickets: glow + one beep and one spoken line per refresh (never for what was already there when the screen opened)
  useEffect(() => {
    if (!data) return;
    const ids = data.filter((t) => t.status === 'pending').map((t) => t.id);
    const fresh = freshIds(seen.current, ids);
    if (fresh.length) {
      const at = Date.now();
      setGlow((g) => ({ ...pruneMarks(g, at, NEW_GLOW_MS), ...Object.fromEntries(fresh.map((id) => [id, at])) }));
      if (sound) playAlert('kitchen');
      if (kitchenVoice) {
        const fresher = new Set(fresh);
        say(newKotLine(data.filter((t) => fresher.has(t.id)).map((t) => ({
          table_label: t.table_label, bill_label: t.bill_label, token_no: t.token_no, channel: t.channel, items: t.items,
        })), { items: kitchenItems }));
      }
      void useBadges.getState().refresh();
    }
    seen.current = new Set([...(seen.current ?? []), ...data.map((t) => t.id)]);
  }, [data, sound, kitchenVoice, kitchenItems]);

  // Server list + local optimistic changes (kept briefly so a slow poll can't flip a bumped ticket back)
  const tickets = useMemo(() => {
    const t0 = Date.now();
    const list = (data ?? []).map((t) => {
      const fresh = (o: ItemOverride | undefined) => !!o && t0 - o.at <= OVERRIDE_TTL;
      if (!t.items.some((i) => fresh(itemOverrides[i.id]))) return { ...t };
      const items = t.items.map((i) => (fresh(itemOverrides[i.id]) && !i.is_void ? { ...i, status: itemOverrides[i.id]!.status } : i));
      return { ...t, items, status: ticketStatusFrom(items, t.status) };
    });
    for (const o of Object.values(overrides)) {
      if (t0 - o.at > OVERRIDE_TTL) continue;
      const found = list.find((t) => t.id === o.ticket.id);
      if (found) found.status = o.status;
      else if (ACTIVE.includes(o.status)) list.push({ ...o.ticket, status: o.status });
    }
    return list.filter((t) => ACTIVE.includes(t.status)).sort((a, b) => a.created_at.localeCompare(b.created_at));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, overrides, itemOverrides, now]);

  const brandOptions = useMemo(() => {
    const names = new Set<string>(brandsInStore.filter((b) => b.is_active).map((b) => b.name));
    tickets.forEach((t) => t.brand && names.add(t.brand));
    return Array.from(names);
  }, [brandsInStore, tickets]);

  const brandFiltered = useMemo(() => tickets.filter((t) => !brand || t.brand === brand), [tickets, brand]);
  const counts = useMemo(() => kindCounts(brandFiltered), [brandFiltered]);
  const visible = useMemo(() => brandFiltered.filter((t) => kind === 'all' || ticketKind(t) === kind), [brandFiltered, kind]);
  const byColumn = useCallback((c: Column) => visible.filter((t) => t.status === c), [visible]);
  // Keyboard numbering follows what is on screen: column by column (or the open tab)
  const ordered = useMemo(() => (tabsMode ? byColumn(tab) : COLUMNS.flatMap((c) => byColumn(c.key))), [tabsMode, tab, byColumn]);

  /**
   * One ticket change: shown at once (`shown`; "served" = off the screen), then the server's answer decides.
   * `call` returns the ticket's status afterwards (a recalled ticket whose food the waiter already served stays off).
   */
  const run = useCallback(async (ticket: FloorTicket, shown: TicketStatus, call: () => Promise<TicketStatus>, after: (status: TicketStatus) => void) => {
    setBusy((b) => ({ ...b, [ticket.id]: true }));
    setOverrides((o) => ({ ...o, [ticket.id]: { ticket, status: shown, at: Date.now() } }));
    try {
      const status = await call();
      setOverrides((o) => ({ ...o, [ticket.id]: { ticket, status, at: Date.now() } }));
      after(status);
      void useBadges.getState().refresh();
      void silentReload();
    } catch (e) {
      setOverrides((o) => {
        const { [ticket.id]: _drop, ...rest } = o;
        return rest;
      });
      toast.error(errorMessage(e));
      void silentReload();
    } finally {
      setBusy((b) => ({ ...b, [ticket.id]: false }));
    }
  }, [silentReload]);

  /** Recall (menu) or Undo right after a bump: back on the screen; food a waiter served stays served. */
  const recall = useCallback(function recall(ticket: FloorTicket, isUndo = false) {
    void run(ticket, 'ready', async () => (await floorApi.recallTicket(ticket.id)).status, (status) => {
      setBumped((list) => list.filter((x) => x.ticket.id !== ticket.id));
      if (status === 'served') toast.info(tr('ops.KitchenScreen.kot_v_was_already_served', { v: kotName(ticket) }));
      else if (!isUndo) toast.success(tr('ops.KitchenScreen.kot_v_is_back_in_ready', { v: kotName(ticket) }));
    });
  }, [run]);

  /** Bump: clears a ready ticket off the screen. Dine-in food waits for the waiter; takeaway / delivery is served by the bump. */
  const bumpOff = useCallback((ticket: FloorTicket) => {
    let served = false;
    void run(ticket, 'served', async () => {
      const r = await floorApi.bumpTicket(ticket.id);
      served = r.served;
      // Off the screen whatever its food status is now
      return 'served';
    }, () => {
      setBumped((list) => [{ ticket: { ...ticket, bumped_at: new Date().toISOString() }, at: Date.now() }, ...list.filter((x) => x.ticket.id !== ticket.id)].slice(0, 20));
      // Bump now, offer Undo (docs/20 §1.4) — 8 s, a busy cook may look up late
      toast.undo(served ? tr('ops.KitchenScreen.kot_v_bumped_and_served', { v: kotName(ticket) }) : tr('ops.KitchenScreen.kot_v_bumped_ready_to_serve', { v: kotName(ticket) }),
        () => recall(ticket, true), 8_000);
    });
  }, [run, recall]);

  /** Start / Ready for the whole ticket, with Undo back to where it was. */
  const move = useCallback(function move(ticket: FloorTicket, next: TicketStatus, isUndo = false) {
    const prev = ticket.status;
    void run(ticket, next, async () => (await floorApi.setTicketStatus(ticket.id, next)).status, () => {
      if (!isUndo) {
        toast.undo(tr('ops.KitchenScreen.kot_v_marked_v2', { v: kotName(ticket), v2: STATUS_WORD[next] }),
          () => move({ ...ticket, status: next }, prev, true), 8_000);
      }
    });
  }, [run]);

  const bump = useCallback((t: FloorTicket) => {
    const next = bumpTarget(t.status as TicketStatus);
    if (!next || busy[t.id]) return;
    if (next === 'bump') bumpOff(t);
    else move(t, next);
  }, [busy, bumpOff, move]);

  /** One line on a ticket (2 ready, 2 still cooking). */
  const changeItem = useCallback(async (ticket: FloorTicket, item: FloorTicketItem, next: ItemStatus) => {
    if (item.is_void || itemBusy[item.id]) return;
    setItemBusy((b) => ({ ...b, [item.id]: true }));
    setItemOverrides((o) => ({ ...o, [item.id]: { status: next, at: Date.now() } }));
    try {
      await floorApi.setItemsStatus(ticket.order_id, [item.id], next);
      void useBadges.getState().refresh();
      void silentReload();
    } catch (e) {
      setItemOverrides((o) => {
        const { [item.id]: _drop, ...rest } = o;
        return rest;
      });
      toast.error(errorMessage(e));
      void silentReload();
    } finally {
      setItemBusy((b) => ({ ...b, [item.id]: false }));
    }
  }, [itemBusy, silentReload]);

  const print = useCallback(async (t: FloorTicket) => {
    try {
      await printKitchenTicket(kotFromTicket(t));
    } catch (e) {
      toast.error(printErrorMessage(e));
    }
  }, []);

  const toggleFullscreen = () => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const doc: any = document;
    if (doc.fullscreenElement) void doc.exitFullscreen?.();
    else void doc.documentElement.requestFullscreen?.().catch(() => toast.info(tr('ops.KitchenScreen.full_screen_is_not_available_here')));
  };

  // Recall: tickets bumped on this screen, plus tickets bumped or served in the last 2 h on any screen (newest first)
  const loadRecall = useCallback(async () => {
    try {
      const recent = await floorApi.tickets('recent');
      setRecallServer(recent.filter((t) => t.status !== 'cancelled' && !!t.bumped_at).slice(0, 12));
    } catch {
      /* offline: local list only */
    }
  }, []);
  const recallItems = useMemo<ActionMenuItem[]>(() => {
    const t0 = Date.now();
    const local = bumped.filter((x) => t0 - x.at < RECALL_KEEP_MS).map((x) => x.ticket);
    const seenIds = new Set(local.map((t) => t.id));
    const list = [...local, ...recallServer.filter((t) => !seenIds.has(t.id))].slice(0, 10);
    if (!list.length) return [{ key: 'none', label: tr('ops.KitchenScreen.nothing_bumped_recently'), icon: 'time-outline', disabled: true, onPress: () => {} }];
    return list.map((t) => ({
      key: t.id, icon: 'arrow-undo-outline', label: tr('ops.KitchenScreen.tickettitle_kot_v', { ticketTitle: ticketTitle(t), v: t.kot_no ?? '—' }),
      description: [t.bumped_at ? (minutesBetween(t.bumped_at, t0) >= 1
        ? tr('ops.KitchenScreen.bumped_age_ago', { age: formatAge(minutesBetween(t.bumped_at, t0)).toLowerCase() })
        : tr('ops.KitchenScreen.bumped_just_now')) : null,
        t.items.filter((i) => !i.is_void).map((i) => `${i.quantity}× ${i.name}`).join(', ')].filter(Boolean).join(' · ').slice(0, 70) || undefined,
      onPress: () => recall(t),
    }));
  }, [bumped, recallServer, recall]);

  // Keyboard (optional; wall screens work without it): 1–9 pick a ticket, Space bumps it, Esc clears
  const numberKeys = useMemo(() => {
    const map: Record<string, () => void> = {};
    for (let n = 1; n <= 9; n += 1) map[String(n)] = () => { const t = ordered[n - 1]; if (t) setCursor(t.id); };
    return map;
  }, [ordered]);
  useHotkeys({
    ...numberKeys,
    // Only a selected ticket is bumped, so a stray Space press can't clear the oldest order
    Space: () => { const t = ordered.find((x) => x.id === cursor); if (!t) return false; bump(t); setCursor(null); },
    Escape: () => { if (!cursor) return false; setCursor(null); },
  }, [ordered, cursor, bump], { enabled: ordered.length > 0 });

  const renderTicket = (t: FloorTicket, index: number) => (
    <TicketCard key={t.id} ticket={t} now={now} ageLimits={ages.kitchen} large={large} busy={!!busy[t.id]} itemBusy={itemBusy} index={index}
      isNew={!!glow[t.id] && now - glow[t.id]! < NEW_GLOW_MS} selected={cursor === t.id}
      onBump={() => bump(t)} onItem={(item, next) => void changeItem(t, item, next)} onPrint={() => void print(t)} />
  );

  const kindFilters = [
    { key: 'all', label: tr('common.all'), count: counts.all },
    ...(Object.keys(KIND_LABEL) as (keyof typeof KIND_LABEL)[])
      .filter((k) => counts[k] > 0 || k === 'DINE_IN' || k === 'TAKEAWAY' || kind === k)
      .map((k) => ({ key: k, label: KIND_LABEL[k], count: counts[k] })),
  ];
  const brandMenu = brandOptions.length ? (
    <ActionMenu
      align="end"
      title={tr('ops.KitchenScreen.brand')}
      items={[
        { key: 'all', label: tr('ops.KitchenScreen.all_brands'), selected: !brand, onPress: () => setBrand(null) },
        ...brandOptions.map((b) => ({ key: b, label: b, icon: 'pricetag-outline' as const, selected: brand === b, onPress: () => setBrand(b) })),
      ]}
      trigger={(open) => <Button title={brand ?? (isPhone ? tr('ops.KitchenScreen.brand') : tr('ops.KitchenScreen.all_brands'))} icon="pricetag-outline" iconRight="chevron-down" variant={brand ? 'tonal' : 'outline'} size="sm" onPress={open} />}
    />
  ) : null;

  const nNew = byColumn('pending').length; const nPrep = byColumn('preparing').length; const nReady = byColumn('ready').length;
  let body: React.ReactNode;
  if (loading && !data) {
    body = tabsMode ? (
      <View style={{ gap: 12 }}>{[0, 1].map((i) => <Skeleton key={i} height={220} radius={14} />)}</View>
    ) : (
      <View style={styles.columns}>{COLUMNS.map((c) => <View key={c.key} style={{ flex: 1, gap: 12 }}><Skeleton height={44} /><Skeleton height={240} radius={14} /></View>)}</View>
    );
  } else if (error && !data) {
    body = <ErrorState message={error} onRetry={reload} />;
  } else if (!tickets.length) {
    body = (
      <EmptyState icon="restaurant-outline" title={tr('ops.KitchenScreen.kitchen_is_clear')}
        message={tr('ops.KitchenScreen.new_kitchen_tickets_kots_appear_here_as')} />
    );
  } else if (!visible.length) {
    body = <EmptyState icon="funnel-outline" title={tr('ops.KitchenScreen.no_tickets_for_this_filter')} action={{ label: tr('common.show_all'), onPress: () => { setKind('all'); setBrand(null); } }} />;
  } else if (tabsMode) {
    const list = byColumn(tab);
    body = (
      <ScrollView contentContainerStyle={{ paddingBottom: 96, gap: 12 }}>
        {list.length ? (
          <View style={[styles.tabGrid, !isPhone && { flexDirection: 'row', flexWrap: 'wrap' }]}>
            {list.map((t, i) => <View key={t.id} style={!isPhone ? { width: '48.9%' } : undefined}>{renderTicket(t, i)}</View>)}
          </View>
        ) : <ColumnEmpty column={tab} />}
      </ScrollView>
    );
  } else {
    let n = 0;
    body = (
      <View style={styles.columns}>
        {COLUMNS.map((c) => {
          const list = byColumn(c.key);
          return (
            <View key={c.key} style={[styles.column, { backgroundColor: colors.surfaceSunken }]}>
              <ColumnHeader column={c.key} label={c.label} count={list.length} large={large} />
              <ScrollView contentContainerStyle={{ gap: 12, padding: 10, paddingBottom: 96 }}>
                {list.length ? list.map((t) => renderTicket(t, n++)) : <ColumnEmpty column={c.key} />}
              </ScrollView>
            </View>
          );
        })}
      </View>
    );
  }

  return (
    <Screen
      title={tr('common.kitchen')}
      subtitle={tickets.length ? tr('ops.KitchenScreen.nnew_new_nprep_preparing_nready_ready', { nNew, nPrep, nReady }) : undefined}
      scroll={false}
      maxWidth={isDesktop ? 2600 : 1280}
      contentStyle={{ flex: 1 }}
      phoneActions={isPhone ? (
        // Phones: the title gets row 1; these share row 2 as equal-size buttons (they always fit: 4 × 44 px at 320 px)
        <View style={{ flex: 1, gap: 8 }}>
          {canSpeak && kitchenVoice && !voiceTapped && voiceNeedsTap() ? (
            <Button title={tr('ops.KitchenScreen.tap_to_turn_on_voice')} icon="mic-outline" variant="primary" full
              onPress={() => { setVoiceTapped(true); sayNow(VOICE_ON_LINE); }} />
          ) : null}
          <View style={styles.phoneActionRow}>
            <View style={styles.phoneAction}>
              <ActionMenu align="start" title={tr('ops.KitchenScreen.recall_a_bumped_ticket')} items={recallItems} width={320} style={styles.phoneActionButton}
                trigger={(open) => <IconButton icon="arrow-undo-outline" variant="outline" accessibilityLabel={tr('ops.KitchenScreen.recall_a_bumped_ticket')}
                  style={styles.phoneActionButton} onPress={() => { void loadRecall(); open(); }} />} />
            </View>
            {canSpeak ? (
              <View style={styles.phoneAction}>
                <IconButton icon={kitchenVoice ? 'mic-outline' : 'mic-off-outline'} variant={kitchenVoice ? 'secondary' : 'tonal'} style={styles.phoneActionButton}
                  accessibilityLabel={kitchenVoice ? tr('ops.KitchenScreen.turn_off_voice') : tr('ops.KitchenScreen.turn_on_voice')}
                  onPress={() => { setVoicePrefs({ kitchenVoice: !kitchenVoice }); if (!kitchenVoice) { setVoiceTapped(true); sayNow(VOICE_ON_LINE); } }} />
              </View>
            ) : null}
            <View style={styles.phoneAction}>
              <IconButton icon={sound ? 'volume-high-outline' : 'volume-mute-outline'} variant={sound ? 'secondary' : 'tonal'} style={styles.phoneActionButton}
                accessibilityLabel={sound ? tr('ops.KitchenScreen.mute_new_ticket_sound') : tr('ops.KitchenScreen.turn_on_new_ticket_sound')} onPress={() => { setSound(!sound); if (!sound) playAlert('kitchen'); }} />
            </View>
            <View style={styles.phoneAction}>
              <IconButton icon={large ? 'remove-circle-outline' : 'text-outline'} variant="secondary" style={styles.phoneActionButton}
                accessibilityLabel={large ? tr('ops.KitchenScreen.smaller_text') : tr('ops.KitchenScreen.larger_text')} onPress={() => setLarge(!large)} />
            </View>
          </View>
        </View>
      ) : undefined}
      actions={
        <>
          <ActionMenu align="end" title={tr('ops.KitchenScreen.recall_a_bumped_ticket')} items={recallItems} width={320}
            trigger={(open) => <Button title={isPhone ? undefined : tr('ops.KitchenScreen.recall')} icon="arrow-undo-outline" variant="outline" accessibilityLabel={tr('ops.KitchenScreen.recall_a_bumped_ticket')}
              onPress={() => { void loadRecall(); open(); }} />} />
          {canSpeak && kitchenVoice && !voiceTapped && voiceNeedsTap() ? (
            <Button title={tr('ops.KitchenScreen.tap_to_turn_on_voice')} icon="mic-outline" variant="primary"
              onPress={() => { setVoiceTapped(true); sayNow(VOICE_ON_LINE); }} />
          ) : null}
          {canSpeak ? (
            <IconButton icon={kitchenVoice ? 'mic-outline' : 'mic-off-outline'} variant={kitchenVoice ? 'secondary' : 'tonal'}
              accessibilityLabel={kitchenVoice ? tr('ops.KitchenScreen.turn_off_voice') : tr('ops.KitchenScreen.turn_on_voice')}
              onPress={() => { setVoicePrefs({ kitchenVoice: !kitchenVoice }); if (!kitchenVoice) { setVoiceTapped(true); sayNow(VOICE_ON_LINE); } }} />
          ) : null}
          <IconButton icon={sound ? 'volume-high-outline' : 'volume-mute-outline'} variant={sound ? 'secondary' : 'tonal'}
            accessibilityLabel={sound ? tr('ops.KitchenScreen.mute_new_ticket_sound') : tr('ops.KitchenScreen.turn_on_new_ticket_sound')} onPress={() => { setSound(!sound); if (!sound) playAlert('kitchen'); }} />
          <IconButton icon={large ? 'remove-circle-outline' : 'text-outline'} variant="secondary" accessibilityLabel={large ? tr('ops.KitchenScreen.smaller_text') : tr('ops.KitchenScreen.larger_text')}
            onPress={() => setLarge(!large)} />
          {Platform.OS === 'web' && !isPhone ? (
            <IconButton icon="expand-outline" variant="secondary" accessibilityLabel={tr('ops.KitchenScreen.toggle_full_screen')} onPress={toggleFullscreen} />
          ) : null}
        </>
      }
      toolbar={
        <View style={{ gap: 8 }}>
          <FilterBar filters={kindFilters} value={kind} onChange={(k) => setKind(k as KitchenKindFilter)} right={brandMenu} />
          <View style={styles.statusRow}>
            <LiveStatus updatedAt={poll.updatedAt} error={data ? error : null} paused={!poll.live} intervalLabel="5 s" />
            {showKeys && ordered.length ? (
              <View style={styles.hint}>
                <ShortcutHint keys="1" /><Text variant="caption" tone="subtle">–</Text><ShortcutHint keys="9" />
                <Text variant="caption" tone="subtle">{tr('ops.KitchenScreen.select')}</Text>
                <ShortcutHint keys="Space" /><Text variant="caption" tone="subtle">{tr('ops.KitchenScreen.bump')}</Text>
              </View>
            ) : null}
          </View>
          {tabsMode && tickets.length ? (
            <Segmented<Column> value={tab} onChange={setTab} options={COLUMNS.map((c) => ({ value: c.key, label: `${c.label} ${byColumn(c.key).length}` }))} />
          ) : null}
        </View>
      }
    >
      <View style={{ flex: 1, minHeight: 0 }}>{body}</View>
    </Screen>
  );
}

function ticketTitle(t: FloorTicket): string {
  return t.table_label ? `Table ${t.table_label}` : t.token_no ? `Token ${t.token_no}` : ORDER_TYPE_UI[t.type] ?? t.type;
}

function ColumnHeader({ column, label, count, large }: { column: Column; label: string; count: number; large: boolean }) {
  const { colors } = useTheme();
  const tint = column === 'pending' ? colors.kitchen : column === 'preparing' ? colors.info : colors.success;
  return (
    <View style={[styles.columnHead, { borderBottomColor: tint }]}>
      <StatusPill status={column} label={label} size="md" />
      <View style={{ flex: 1 }} />
      <Text variant={large ? 'h1' : 'h2'} style={{ fontVariant: ['tabular-nums'] }}>{count}</Text>
    </View>
  );
}

function ColumnEmpty({ column }: { column: Column }) {
  const msg = column === 'pending' ? tr('ops.KitchenScreen.no_new_tickets') : column === 'preparing' ? tr('ops.KitchenScreen.nothing_cooking_right_now') : tr('ops.KitchenScreen.nothing_waiting_to_be_served');
  return (
    <View style={{ paddingVertical: 32, alignItems: 'center' }}>
      <Text tone="subtle">{msg}</Text>
    </View>
  );
}

const TicketCard = React.memo(function TicketCard({ ticket, now, ageLimits, large, busy, itemBusy, index, isNew, selected, onBump, onItem, onPrint }: {
  ticket: FloorTicket; now: number; ageLimits: AgeThresholds; large: boolean; busy: boolean; itemBusy: Record<string, boolean>; index: number; isNew: boolean; selected: boolean;
  onBump: () => void; onItem: (item: FloorTicketItem, next: ItemStatus) => void; onPrint: () => void;
}) {
  const { colors, radius } = useTheme();
  const mins = minutesBetween(ticket.created_at, now);
  const tone = ageTone(mins, ageLimits);
  const age = ageColors(colors, tone);
  const col = COLUMNS.find((c) => c.key === ticket.status) ?? COLUMNS[0]!;
  const qtySize = large ? 32 : 24;
  const nameSize = large ? 24 : 18;
  const live = ticket.items.filter((i) => !i.is_void);
  const totalQty = live.reduce((s, i) => s + i.quantity, 0);
  const cancelled = ticket.items.length - live.length;
  const bumpVariant = ticket.status === 'pending' ? 'kitchen' : ticket.status === 'preparing' ? 'success' : 'primary';
  const border = selected ? colors.primary : isNew ? colors.kitchen : tone !== 'ok' ? age.solid : colors.border;

  return (
    <View style={[styles.ticket, { backgroundColor: isNew ? colors.kitchenSoft : colors.surface, borderColor: border, borderRadius: radius.lg, borderWidth: selected || isNew ? 3 : 1.5 }]}
      accessibilityLabel={tr('ops.KitchenScreen.kitchen_ticket_v_formatage_old_v2', { v: ticket.kot_no ?? ticket.order_code, formatAge: formatAge(mins), v2: isNew ? tr('ops.KitchenScreen.new_2') : '' })}>
      <View style={[styles.ticketBar, { backgroundColor: tone === 'ok' ? (isNew ? colors.kitchen : colors.borderStrong) : age.solid }]} />
      <View style={styles.ticketHead}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={styles.titleRow}>
            {index < 9 ? <ShortcutHint keys={String(index + 1)} /> : null}
            <Text variant={large ? 'display' : 'h1'} numberOfLines={1} style={{ flexShrink: 1 }}>
              {ticketTitle(ticket)}
              {ticket.bill_label ? <Text variant={large ? 'h2' : 'h3'} tone="primary"> · {ticket.bill_label}</Text> : null}
            </Text>
          </View>
          <Text variant={large ? 'body' : 'small'} tone="muted" numberOfLines={1}>
            KOT {ticket.kot_no ?? '—'} · #{ticket.order_code}{ticket.token_no && ticket.table_label ? tr('ops.KitchenScreen.token_token_no', { token_no: ticket.token_no }) : ''}
          </Text>
        </View>
        <AgeChip minutes={mins} tone={tone} size={large ? 'lg' : 'md'} />
      </View>

      <View style={styles.badges}>
        {isNew ? <StatusPill status="placed" label="NEW" /> : null}
        <StatusPill status="neutral" label={ORDER_TYPE_UI[ticket.type] ?? ticket.type} showIcon={false} />
        {ticket.channel !== 'POS' ? <StatusPill status="brand" label={channelLabel(ticket.channel)} showIcon={false} /> : null}
        {ticket.brand ? <StatusPill status="brand" label={ticket.brand} /> : null}
        {ticket.customer_name ? <StatusPill status="neutral" label={ticket.customer_name} showIcon={false} /> : null}
      </View>

      <View style={[styles.items, { borderTopColor: colors.divider, borderBottomColor: colors.divider }]}>
        {ticket.items.map((i) => (
          <TicketItem key={i.id} item={i} large={large} qtySize={qtySize} nameSize={nameSize} busy={!!itemBusy[i.id]} onItem={onItem} />
        ))}
        {!ticket.items.length ? <Text tone="subtle">{tr('ops.KitchenScreen.no_items_on_this_ticket')}</Text> : null}
      </View>

      {ticket.notes ? (
        <View style={[styles.note, { backgroundColor: colors.dangerSoft, borderRadius: radius.sm, padding: 10 }]}>
          <Ionicons name="chatbox-ellipses" size={large ? 20 : 16} color={colors.dangerText} />
          <Text variant={large ? 'h3' : 'smallStrong'} color={colors.dangerText} style={{ flex: 1 }}>{ticket.notes}</Text>
        </View>
      ) : null}

      <View style={styles.ticketFoot}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant={large ? 'bodyStrong' : 'smallStrong'} numberOfLines={1}>{totalQty} {tr('common.item_2')}{totalQty === 1 ? '' : 's'}</Text>
          {cancelled ? <Text variant="caption" tone="danger" numberOfLines={1}>{cancelled} {tr('ops.KitchenScreen.cancelled')}</Text> : null}
        </View>
        <IconButton icon="print-outline" variant="secondary" accessibilityLabel={tr('ops.KitchenScreen.print_kot_v', { v: ticket.kot_no ?? '' })} onPress={onPrint} />
        <Button title={col.bump} icon={col.icon} variant={bumpVariant} size="lg" loading={busy} disabled={busy}
          onPress={onBump} accessibilityLabel={tr('ops.KitchenScreen.bump_kot_v_to_v2', { v: ticket.kot_no ?? '', v2: bumpWord(bumpTarget(ticket.status as TicketStatus)) })}
          style={{ minWidth: large ? 170 : 140 }} shortcut={selected ? 'Space' : undefined} />
      </View>
    </View>
  );
});

/** One line: tap to move it on (New → Cooking → Ready → Served), long-press to step back. Cancelled lines are struck out in red. */
function TicketItem({ item, large, qtySize, nameSize, busy, onItem }: {
  item: FloorTicketItem; large: boolean; qtySize: number; nameSize: number; busy: boolean; onItem: (item: FloorTicketItem, next: ItemStatus) => void;
}) {
  const { colors, radius } = useTheme();
  const status = (['pending', 'preparing', 'ready', 'served'].includes(item.status) ? item.status : 'pending') as ItemStatus;
  const next = nextItemStep(status); // stops at Ready: the floor serves
  const prev = prevItemStep(status); // a served line is left alone
  const voided = item.is_void;
  const done = status === 'served';
  const textColor = voided ? colors.danger : done ? colors.textSubtle : undefined;

  const content = (
    <>
      <Text style={[{ fontSize: qtySize, lineHeight: qtySize + 6, minWidth: large ? 48 : 36, fontVariant: ['tabular-nums'] }, (voided || done) && styles.strike]}
        variant="h1" color={textColor}>{item.quantity}</Text>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text variant="h3" style={[{ fontSize: nameSize, lineHeight: nameSize + 6 }, (voided || done) && styles.strike]} numberOfLines={3} color={textColor}>
          {item.name}
        </Text>
        {item.variant_name ? <Text variant={large ? 'body' : 'small'} tone={voided ? 'danger' : 'muted'} numberOfLines={1} style={voided ? styles.strike : undefined}>{item.variant_name}</Text> : null}
        {voided ? (
          <View style={[styles.note, { backgroundColor: colors.danger, borderRadius: radius.sm }]}>
            <Ionicons name="close-circle" size={large ? 20 : 16} color={colors.onDanger} />
            <Text variant={large ? 'h3' : 'smallStrong'} color={colors.onDanger} style={{ flex: 1 }}>
              {tr('ops.KitchenScreen.don_t_make_cancelled')}{item.void_reason ? ` · ${item.void_reason}` : ''}
            </Text>
          </View>
        ) : item.notes ? (
          <View style={[styles.note, { backgroundColor: colors.kitchenSoft, borderRadius: radius.sm }]}>
            <Ionicons name="alert-circle" size={large ? 18 : 15} color={colors.kitchenText} />
            <Text variant={large ? 'bodyStrong' : 'smallStrong'} color={colors.kitchenText} style={{ flex: 1 }}>{item.notes}</Text>
          </View>
        ) : null}
      </View>
      {!voided ? (
        <StatusPill status={status} label={busy ? '…' : ITEM_WORD[status]} size={large ? 'md' : 'sm'} style={{ alignSelf: 'center' }} />
      ) : null}
    </>
  );

  if (voided) {
    return <View style={styles.item} accessibilityLabel={tr('ops.KitchenScreen.quantity_name_cancelled_don_t_make_v', { quantity: item.quantity, name: item.name, v: item.void_reason ? `: ${item.void_reason}` : '' })}>{content}</View>;
  }
  return (
    <Pressable onPress={() => next && onItem(item, next)} onLongPress={() => prev && onItem(item, prev)} delayLongPress={450} disabled={busy}
      accessibilityRole="button" accessibilityState={{ busy }}
      accessibilityLabel={`${item.quantity} ${item.name}, ${ITEM_WORD[status]}${next ? tr('ops.KitchenScreen.tap_to_mark_tolowercase', { toLowerCase: ITEM_WORD[next].toLowerCase() }) : ''}${prev ? tr('ops.KitchenScreen.long_press_to_undo') : ''}`}
      style={({ pressed, hovered }: any) => [styles.item, styles.itemTap, { borderRadius: radius.md, minHeight: large ? 56 : 48 },
        (pressed || hovered) && next ? { backgroundColor: colors.surfaceSunken } : null,
        Platform.OS === 'web' && ({ cursor: next ? 'pointer' : 'default', userSelect: 'none' } as any)]}>
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  phoneActionRow: { flexDirection: 'row', gap: 8 },
  phoneAction: { flex: 1, minWidth: 44 },
  phoneActionButton: { width: '100%' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 12, justifyContent: 'space-between', flexWrap: 'wrap' },
  hint: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  columns: { flex: 1, flexDirection: 'row', gap: 12, minHeight: 0 },
  column: { flex: 1, borderRadius: 14, overflow: 'hidden', minWidth: 0 },
  columnHead: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 3 },
  tabGrid: { gap: 12, justifyContent: 'space-between' },
  ticket: { padding: 14, paddingTop: 16, gap: 10, overflow: 'hidden' },
  ticketBar: { position: 'absolute', top: 0, left: 0, right: 0, height: 6 },
  ticketHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  items: { borderTopWidth: 1, borderBottomWidth: 1, paddingVertical: 8, gap: 6 },
  item: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  itemTap: { marginHorizontal: -6, paddingHorizontal: 6, paddingVertical: 4 },
  strike: { textDecorationLine: 'line-through' },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, paddingHorizontal: 8, paddingVertical: 6, marginTop: 2 },
  ticketFoot: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
