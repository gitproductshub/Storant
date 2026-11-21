/**
 * Offers & loyalty rewards: a dense list (table on wide screens, cards on phones) with status pills, an inline
 * on/off switch, search and filter chips with counts, and the editor in a side panel (full screen on phones).
 * Managing offers needs the internet; the POS keeps billing without them.
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Switch, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { errorMessage } from '@/api/client';
import { offersApi, type Offer, type OfferKind } from '@/api/offers';
import {
  ActionMenu, Badge, Button, DataList, EmptyState, FilterBar, Loading, Screen, StatusPill, Text, toast, useHotkeys,
  type ActionMenuItem, type DataColumn, type FilterOption,
} from '@/components/ui';
import { useApi } from '@/hooks/useApi';
import { useAccessInfo, useCan } from '@/store/access';
import { formatDate } from '@/lib/format';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { TopDialogHost } from '@/features/catalog/dialogs';
import { OfferEditor } from './OfferEditor';
import { offerCounts, offerMatches, offerPill, searchOffers, sortOffers, toggledState, type OfferFilter } from './offerList';
import { t as tr } from '@/i18n';

export default function OffersScreen() {
  const info = useAccessInfo();
  const canManage = useCan('offers.manage', 'offers');
  if (!info) {
    return <Screen title={tr('common.offers_rewards')}><Loading label={tr('offers.OffersScreen.checking_your_access')} /></Screen>;
  }
  if (!canManage) {
    return (
      <Screen title={tr('common.offers_rewards')}>
        <EmptyState icon="lock-closed-outline" title={info.features.includes('offers') ? tr('offers.OffersScreen.only_managers_can_change_offers') : tr('offers.OffersScreen.offers_aren_t_in_your_plan')}
          message={info.features.includes('offers')
            ? tr('offers.OffersScreen.ask_the_owner_or_a_manager_to_create')
            : tr('offers.OffersScreen.upgrade_your_plan_to_run_discounts_coupon')} />
      </Screen>
    );
  }
  return <Offers />;
}

function endsLabel(o: Offer): string {
  if (!o.starts_at && !o.ends_at) return 'No end date';
  const parts: string[] = [];
  if (o.starts_at && new Date(o.starts_at).getTime() > Date.now()) parts.push(`from ${formatDate(o.starts_at)}`);
  if (o.ends_at) parts.push(`until ${formatDate(new Date(new Date(o.ends_at).getTime() - 1).toISOString())}`);
  return parts.join(' ') || 'No end date';
}

function usesLabel(o: Offer): string {
  return o.max_uses_total ? `${o.uses_count}/${o.max_uses_total}` : String(o.redemptions);
}

function Offers() {
  const { colors } = useTheme();
  const { isPhone, isDesktop } = useLayout();
  const info = useAccessInfo();
  const loyaltyAllowed = !!info?.features.includes('loyalty');
  const canAnnounce = useCan('email.manage', 'email');
  const { data, setData, error, loading, refreshing, reload } = useApi(() => offersApi.list(true), []);
  const [filter, setFilter] = useState<OfferFilter>('all');
  const [q, setQ] = useState('');
  const [editor, setEditor] = useState<{ offer: Offer | null; kind: OfferKind; key: number } | null>(null);
  const [toggling, setToggling] = useState<Record<string, boolean>>({});
  const [listWidth, setListWidth] = useState(0);
  const tableMode = !isPhone && (listWidth || 9999) >= 560;

  const all = useMemo(() => data ?? [], [data]);
  const searched = useMemo(() => searchOffers(all, q), [all, q]);
  const counts = useMemo(() => offerCounts(searched), [searched]);
  const rows = useMemo(() => sortOffers(searched.filter((o) => offerMatches(o, filter))), [searched, filter]);
  const liveCount = all.filter((o) => o.state === 'live').length;

  const upsert = useCallback((o: Offer) => setData((prev) => {
    const base = prev ?? [];
    return base.some((x) => x.id === o.id) ? base.map((x) => (x.id === o.id ? { ...o, redemptions: x.redemptions } : x)) : [o, ...base];
  }), [setData]);

  /** Instant on/off (reversible, so no confirmation): the row flips at once, the server confirms; switching off offers Undo. */
  const toggleRef = useRef<(o: Offer, on: boolean) => Promise<void>>(async () => {});
  const toggle = useCallback(async (o: Offer, on: boolean) => {
    if (toggling[o.id]) return;
    setToggling((t) => ({ ...t, [o.id]: true }));
    upsert({ ...o, is_active: on, state: toggledState(o, on) });
    try {
      const saved = await offersApi.setActive(o.id, on);
      const next = { ...saved, redemptions: o.redemptions };
      upsert(next);
      if (on) toast.success(tr('offers.OffersScreen.name_is_on', { name: o.name }));
      else toast.undo(tr('offers.OffersScreen.name_switched_off', { name: o.name }), () => void toggleRef.current(next, true));
    } catch (e) {
      upsert(o);
      toast.error(errorMessage(e));
    } finally {
      setToggling((t) => ({ ...t, [o.id]: false }));
    }
  }, [toggling, upsert]);
  toggleRef.current = toggle;

  const newOffer = useCallback((kind: OfferKind) => setEditor({ offer: null, kind, key: Date.now() }), []);
  const open = useCallback((o: Offer) => setEditor({ offer: o, kind: o.kind, key: Date.now() }), []);
  useHotkeys({ n: () => newOffer(filter === 'loyalty' && loyaltyAllowed ? 'loyalty' : 'bill') }, [newOffer, filter, loyaltyAllowed], { enabled: !editor });

  const offerSwitch = (o: Offer) => (
    <Switch value={o.is_active} onValueChange={(v) => void toggle(o, v)} disabled={!!toggling[o.id]}
      trackColor={{ true: colors.primary, false: colors.borderStrong }} thumbColor={colors.surface}
      accessibilityLabel={o.is_active ? tr('offers.OffersScreen.switch_off_name', { name: o.name }) : tr('offers.OffersScreen.switch_on_name', { name: o.name })} />
  );
  const icon = (o: Offer) => {
    const loyalty = o.kind === 'loyalty';
    return (
      <View style={{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: loyalty ? colors.accentSoft : colors.primarySoft }}>
        <Ionicons name={loyalty ? 'ribbon' : o.benefit_type === 'free_item' ? 'gift' : 'pricetag'} size={15} color={loyalty ? colors.accentText : colors.primary} />
      </View>
    );
  };

  const columns = useMemo<DataColumn<Offer>[]>(() => [
    {
      key: 'name', title: tr('common.offer'), flex: 1.6, minWidth: 180,
      render: (o) => (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0 }}>
          {icon(o)}
          <Text variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>{o.name}</Text>
        </View>
      ),
    },
    { key: 'summary', title: tr('offers.OffersScreen.what_the_customer_gets'), flex: 2.2, minWidth: 160, hideBelow: 900, render: (o) => <Text variant="small" tone="muted" numberOfLines={1}>{o.summary}</Text> },
    { key: 'state', title: tr('common.status'), width: 120, render: (o) => { const p = offerPill(o.state); return <StatusPill status={p.status} label={p.label} />; } },
    { key: 'code', title: tr('offers.OffersScreen.code'), width: 110, hideBelow: 760, render: (o) => (o.code ? <Badge label={o.code} tone="accent" icon="ticket-outline" /> : <Text variant="small" tone="subtle">—</Text>) },
    { key: 'apply', title: tr('offers.OffersScreen.applied'), width: 110, hideBelow: 1180, value: (o) => (o.auto_apply ? 'Automatic' : 'By cashier') },
    { key: 'uses', title: tr('offers.OffersScreen.used'), width: 70, numeric: true, hideBelow: 640, value: usesLabel },
    { key: 'ends', title: tr('offers.OffersScreen.dates'), width: 150, hideBelow: 1040, value: endsLabel },
    { key: 'on', title: tr('common.on'), width: 64, align: 'center', render: offerSwitch },
  ], [colors, toggling, toggle]); // eslint-disable-line react-hooks/exhaustive-deps

  const renderCard = useCallback((o: Offer) => {
    const p = offerPill(o.state);
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        {icon(o)}
        <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>{o.name}</Text>
            <StatusPill status={p.status} label={p.label} showIcon={false} />
          </View>
          <Text variant="small" tone="muted" numberOfLines={2}>{[o.code ? `Code ${o.code}` : null, o.summary].filter(Boolean).join(' · ')}</Text>
        </View>
        {offerSwitch(o)}
      </View>
    );
  }, [colors, toggling, toggle]); // eslint-disable-line react-hooks/exhaustive-deps

  const filters: FilterOption[] = [
    { key: 'all', label: tr('common.all'), count: counts.all },
    { key: 'live', label: tr('common.live'), count: counts.live },
    { key: 'scheduled', label: tr('common.scheduled'), count: counts.scheduled },
    { key: 'off', label: tr('common.off'), count: counts.off },
    ...(counts.ended ? [{ key: 'ended', label: tr('common.ended'), count: counts.ended }] : []),
    ...(loyaltyAllowed || counts.loyalty ? [{ key: 'loyalty', label: tr('common.loyalty'), icon: 'ribbon-outline' as const, count: counts.loyalty }] : []),
  ];

  const newMenu: ActionMenuItem[] = [
    { key: 'bill', label: tr('offers.OffersScreen.offer_on_the_whole_bill'), icon: 'receipt-outline', description: tr('offers.OffersScreen.happy_hour_or_off_above_an_amount'), onPress: () => newOffer('bill') },
    { key: 'items', label: tr('offers.OffersScreen.offer_on_items'), icon: 'fast-food-outline', description: tr('offers.OffersScreen.item_deals_and_free_items'), onPress: () => newOffer('items') },
    { key: 'loyalty', label: tr('offers.OffersScreen.loyalty_reward'), icon: 'ribbon-outline', description: tr('offers.OffersScreen.for_regulars_after_n_visits'), hidden: !loyaltyAllowed, onPress: () => newOffer('loyalty') },
  ];

  const empty = filter === 'loyalty' ? {
    icon: 'ribbon-outline' as const, title: tr('offers.OffersScreen.no_loyalty_rewards_yet'),
    message: tr('offers.OffersScreen.reward_regulars_automatically_for_example'),
    action: loyaltyAllowed ? { label: tr('offers.OffersScreen.new_loyalty_reward'), icon: 'add' as const, onPress: () => newOffer('loyalty') } : undefined,
  } : q || filter !== 'all' ? {
    icon: 'search-outline' as const, title: tr('offers.OffersScreen.no_offers_match'), action: { label: tr('common.show_all'), icon: 'list-outline' as const, onPress: () => { setFilter('all'); setQ(''); } },
  } : {
    icon: 'pricetags-outline' as const, title: tr('offers.OffersScreen.no_offers_yet'),
    message: tr('offers.OffersScreen.create_happy_hour_discounts_item_deals'),
    action: { label: tr('common.new_offer'), icon: 'add' as const, onPress: () => newOffer('bill') },
  };

  return (
    <Screen
      title={tr('common.offers_rewards')}
      subtitle={data ? tr('offers.OffersScreen.livecount_live_length_total', { liveCount, length: all.length }) : undefined}
      scroll={false}
      contentStyle={{ flex: 1, paddingBottom: 16 }}
      maxWidth={isDesktop ? 1680 : 1280}
      actions={(
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {loyaltyAllowed && !isPhone ? <Button title={tr('offers.OffersScreen.new_reward')} icon="ribbon-outline" variant="outline" onPress={() => newOffer('loyalty')} /> : null}
          <ActionMenu items={newMenu} title={tr('common.new')} align="end"
            trigger={(openMenu) => <Button title={isPhone ? tr('common.new') : tr('common.new_offer')} icon="add" onPress={openMenu} shortcut="N" testID="offers-new" />} />
        </View>
      )}
      toolbar={<FilterBar onSearch={setQ} search={q} searchPlaceholder={tr('offers.OffersScreen.search_name_or_coupon_code_x')} filters={filters} value={filter} onChange={(k) => setFilter(k as OfferFilter)} />}
    >
      <View style={{ flex: 1, flexDirection: 'row', gap: 16, minHeight: 0 }}>
        <View style={[{ flex: 1, minWidth: 0, overflow: 'hidden' }, tableMode && { borderWidth: 1, borderRadius: 14, borderColor: colors.border, backgroundColor: colors.surface }]}
          onLayout={(e) => setListWidth(Math.round(e.nativeEvent.layout.width))}>
          <DataList<Offer>
            data={data ? rows : null}
            keyExtractor={(o) => o.id}
            columns={columns}
            renderCard={renderCard}
            layout={tableMode ? 'table' : 'cards'}
            cardHeight={84}
            loading={loading}
            error={error ? tr('offers.OffersScreen.error_offers_can_be_managed_when_you_are', { error }) : null}
            onRetry={reload}
            refreshing={refreshing}
            onRefresh={reload}
            onPressRow={open}
            openKey={editor?.offer?.id ?? null}
            keyboard={!editor}
            extraData={toggling}
            empty={empty}
            testID="offers-list"
          />
        </View>
        {editor ? (
          <OfferEditor key={editor.key} offer={editor.offer} initialKind={editor.kind} loyaltyAllowed={loyaltyAllowed} canAnnounce={canAnnounce}
            onClose={() => setEditor(null)} onSaved={(o) => { upsert(o); setEditor(null); }} />
        ) : null}
      </View>
      <TopDialogHost />
    </Screen>
  );
}
