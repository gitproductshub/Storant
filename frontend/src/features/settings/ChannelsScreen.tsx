import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, Switch, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import { adminApi } from '@/api/endpoints';
import { errorMessage } from '@/api/client';
import type { ChannelCode, SalesChannel } from '@/api/types';
import { Badge, Button, Card, EmptyState, ErrorState, Input, Loading, SectionTitle, Text, confirm, toast } from '@/components/ui';
import { useApi } from '@/hooks/useApi';
import { can, useAuth } from '@/store/auth';
import { useData } from '@/store/data';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { SettingsFrame } from './SettingsFrame';
import { Callout, FieldRow, Hairline, apiBase, copyText, monoFont, SettingSwitch } from './components';
import { fieldErrorsFrom } from './validation';
import { ChannelMenuSheet } from '@/features/catalog/ChannelMenuSheet';
import { brand } from '@/config/brand';
import { t } from '@/i18n';

type IconName = keyof typeof Ionicons.glyphMap;

const META: Partial<Record<ChannelCode, { icon: IconName; blurb: string }>> = {
  SWIGGY: { icon: 'bicycle-outline', blurb: 'Food delivery orders from Swiggy.' },
  ZOMATO: { icon: 'restaurant-outline', blurb: 'Food delivery orders from Zomato.' },
  ONDC: { icon: 'globe-outline', blurb: 'Orders from ONDC buyer apps (Paytm, PhonePe Pincode, Magicpin…) through your ONDC seller app.' },
  MAGICPIN: { icon: 'sparkles-outline', blurb: 'Delivery and pickup orders from magicpin.' },
  OTHER: { icon: 'call-outline', blurb: 'Phone, WhatsApp and other orders you take yourself.' },
  ONLINE: { icon: 'storefront-outline', blurb: 'Your own ordering website. No commission.' },
  QR: { icon: 'qr-code-outline', blurb: 'Guests scan the QR on their table and order from their phone.' },
};

const AGGREGATORS: ChannelCode[] = ['SWIGGY', 'ZOMATO', 'ONDC', 'MAGICPIN'];
const OWN: ChannelCode[] = ['ONLINE', 'QR', 'OTHER'];
const WEBHOOK: ChannelCode[] = ['SWIGGY', 'ZOMATO', 'ONDC', 'MAGICPIN', 'OTHER'];

export default function ChannelsScreen() {
  const role = useAuth((s) => s.session?.role ?? null);
  if (!can(role, 'manage')) {
    return (
      <SettingsFrame active="channels" title={t('common.sales_channels')}>
        <EmptyState icon="lock-closed-outline" title={t('common.managers_only')} message={t('settings.ChannelsScreen.ask_the_owner_or_a_manager_to_change')} />
      </SettingsFrame>
    );
  }
  return <ChannelsList />;
}

function ChannelsList() {
  const { data, error, loading, reload, refreshing, setData } = useApi(() => adminApi.channels(), []);
  const role = useAuth((s) => s.session?.role ?? null);
  const tenantId = useAuth((s) => s.session?.tenantId ?? '');

  const onSaved = (c: SalesChannel) => {
    setData((list) => (list ? list.map((x) => (x.code === c.code ? { ...x, ...c } : x)) : list));
    // Billing reads channels (price markup) from the offline cache.
    useData.setState((s) => ({ channels: s.channels.map((x) => (x.code === c.code ? { ...x, ...c } : x)) }));
  };

  const byCode = (codes: ChannelCode[]) => codes.map((c) => data?.find((x) => x.code === c)).filter((x): x is SalesChannel => !!x);
  const extras = (data ?? []).filter((c) => c.code !== 'POS' && !AGGREGATORS.includes(c.code) && !OWN.includes(c.code));

  return (
    <SettingsFrame active="channels" title={t('common.sales_channels')} subtitle={t('settings.ChannelsScreen.where_your_orders_come_from_turn_on_the')}
      refreshing={refreshing} onRefresh={reload}>
      {loading && !data ? <Loading label={t('settings.ChannelsScreen.loading_channels')} /> : null}
      {error && !data ? <ErrorState message={error} onRetry={reload} /> : null}
      {data ? (
        <>
          <Callout tone="info" icon="information-circle" title={t('settings.ChannelsScreen.how_delivery_app_orders_reach_brand', { brand: brand.name })}>
            {t('settings.ChannelsScreen.swiggy_and_zomato_only_send_orders')}
          </Callout>

          <View style={{ gap: 12 }}>
            <SectionTitle title={t('settings.ChannelsScreen.delivery_apps')} />
            {byCode(AGGREGATORS).map((c) => (
              <ChannelCard key={c.code} channel={c} onSaved={onSaved} isOwner={role === 'owner'} tenantId={tenantId} />
            ))}
          </View>

          <View style={{ gap: 12 }}>
            <SectionTitle title={t('settings.ChannelsScreen.your_own_channels')} />
            {byCode(OWN).map((c) => (
              <ChannelCard key={c.code} channel={c} onSaved={onSaved} isOwner={role === 'owner'} tenantId={tenantId} />
            ))}
            {extras.map((c) => (
              <ChannelCard key={c.code} channel={c} onSaved={onSaved} isOwner={role === 'owner'} tenantId={tenantId} />
            ))}
          </View>
        </>
      ) : null}
    </SettingsFrame>
  );
}

interface Draft { commission: string; markup: string; storeId: string; autoAccept: boolean }

const draftOf = (c: SalesChannel): Draft => ({
  commission: String(c.commission_pct ?? 0),
  markup: String(c.price_adjust_pct ?? 0),
  storeId: c.external_store_id ?? '',
  autoAccept: !!c.auto_accept,
});

function ChannelCard({ channel, onSaved, isOwner, tenantId }: { channel: SalesChannel; onSaved: (c: SalesChannel) => void; isOwner: boolean; tenantId: string }) {
  const { colors } = useTheme();
  const { isPhone } = useLayout();
  const meta = META[channel.code] ?? { icon: 'cart-outline' as IconName, blurb: '' };
  const linked = channel.code === 'ONLINE' || channel.code === 'QR';
  const isAggregator = AGGREGATORS.includes(channel.code);
  const [draft, setDraft] = useState<Draft>(() => draftOf(channel));
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const symbol = useData((s) => s.settings?.currency_symbol) || '₹';
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});

  const base = draftOf(channel);
  const baseKey = JSON.stringify(base);
  const dirty = baseKey !== JSON.stringify(draft);
  // When the channel is refreshed from the server, follow it unless the user is in the middle of editing.
  const lastBase = useRef(baseKey);
  useEffect(() => {
    if (lastBase.current === baseKey) return;
    const previous = lastBase.current;
    lastBase.current = baseKey;
    setDraft((d) => (JSON.stringify(d) === previous ? (JSON.parse(baseKey) as Draft) : d));
  }, [baseKey]);

  const commission = Number(draft.commission);
  const markup = Number(draft.markup);
  const errors: Record<string, string | undefined> = {
    commission: draft.commission.trim() === '' || !Number.isFinite(commission) || commission < 0 || commission > 100 ? 'Use 0 to 100.' : serverErrors.commission_pct,
    markup: draft.markup.trim() === '' || !Number.isFinite(markup) || markup < -50 || markup > 100 ? 'Use -50 to 100.' : serverErrors.price_adjust_pct,
    storeId: draft.storeId.length > 64 ? 'Use 64 characters or fewer.' : serverErrors.external_store_id,
  };
  const invalid = !!(errors.commission || errors.markup || errors.storeId);

  const toggle = async (enabled: boolean) => {
    setToggling(true);
    try {
      const saved = await adminApi.updateChannel(channel.code, { enabled });
      onSaved(saved);
      toast.success(t('settings.ChannelsScreen.name_turned_v', { name: channel.name, v: enabled ? 'on' : 'off' }));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setToggling(false);
    }
  };

  const save = async () => {
    if (invalid) return;
    setSaving(true);
    setServerErrors({});
    try {
      const body: Partial<SalesChannel> = { auto_accept: draft.autoAccept };
      if (!linked) {
        body.commission_pct = commission;
        body.price_adjust_pct = markup;
        body.external_store_id = draft.storeId.trim() || null;
      }
      const saved = await adminApi.updateChannel(channel.code, body);
      onSaved(saved);
      setDraft(draftOf(saved));
      toast.success(t('common.name_saved', { name: channel.name }));
    } catch (e) {
      setServerErrors(fieldErrorsFrom(e));
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const markupExample = Number.isFinite(markup) && markup !== 0
    ? `A ₹200 menu item costs ₹${(200 * (1 + markup / 100)).toFixed(0)} on ${channel.name}, unless the item has its own ${channel.name} price.`
    : 'Same prices as your menu, unless an item has its own price here.';

  return (
    <Card style={{ gap: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: channel.enabled ? colors.primarySoft : colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={meta.icon} size={22} color={channel.enabled ? colors.primarySoftText : colors.textMuted} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Text variant="h3">{channel.name}</Text>
            <Badge label={channel.enabled ? t('common.on') : t('common.off')} tone={channel.enabled ? 'success' : 'neutral'} />
          </View>
          {meta.blurb ? <Text variant="small" tone="muted">{meta.blurb}</Text> : null}
        </View>
        {linked ? null : (
          <View style={{ alignItems: 'flex-end' }}>
            <SwitchToggle value={channel.enabled} disabled={toggling} onChange={toggle} label={t('settings.ChannelsScreen.name_enabled', { name: channel.name })} />
          </View>
        )}
      </View>

      {linked ? (
        <Callout tone="neutral" icon="link-outline"
          action={<Button title={t('settings.ChannelsScreen.open_business_settings')} size="sm" variant="secondary" iconRight="arrow-forward"
            onPress={() => router.navigate('/settings/business?section=online' as Href)} />}>
          {channel.code === 'ONLINE' ? t('settings.ChannelsScreen.turn_your_online_store_on_or_off_and_get') : t('settings.ChannelsScreen.turn_qr_table_ordering_on_or_off_in')}
        </Callout>
      ) : null}

      {channel.enabled || linked ? (
        <>
          <Hairline />
          {!linked ? (
            <>
              <FieldRow>
                <Input label={t('settings.ChannelsScreen.commission')} value={draft.commission} onChangeText={(v) => setDraft((d) => ({ ...d, commission: v.replace(/[^\d.]/g, '') }))}
                  keyboardType="decimal-pad" maxLength={5} error={errors.commission} hint={t('settings.ChannelsScreen.the_app_keeps_reports_show_your_net')} right={<Suffix />} />
                <Input label={t('settings.ChannelsScreen.menu_price_markup')} value={draft.markup} onChangeText={(v) => setDraft((d) => ({ ...d, markup: v.replace(/[^\d.-]/g, '') }))}
                  keyboardType="numbers-and-punctuation" maxLength={5} error={errors.markup} hint={markupExample} right={<Suffix />} />
              </FieldRow>
              {isAggregator || channel.code === 'OTHER' ? (
                <Input label={isAggregator ? t('settings.ChannelsScreen.name_store_outlet_id', { name: channel.name }) : t('settings.ChannelsScreen.reference_id')} value={draft.storeId}
                  onChangeText={(v) => setDraft((d) => ({ ...d, storeId: v }))} maxLength={64} error={errors.storeId}
                  hint={isAggregator ? t('settings.ChannelsScreen.optional_shown_on_orders_so_staff_know') : t('settings.ChannelsScreen.optional')}
                  autoCapitalize="none" autoCorrect={false} placeholder={t('common.optional')} />
              ) : null}
            </>
          ) : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <Ionicons name="list-outline" size={18} color={colors.textMuted} />
            <View style={{ flex: 1, minWidth: 180 }}>
              <Text variant="smallStrong">{t('settings.ChannelsScreen.menu_on_name', { name: channel.name })}</Text>
              <Text variant="small" tone="muted">{t('settings.ChannelsScreen.items_prices_and_what_is_hidden_here_copy')}</Text>
            </View>
            <Button title={t('settings.ChannelsScreen.view_menu')} icon="eye-outline" size="sm" variant="secondary" onPress={() => setMenuOpen(true)}
              accessibilityLabel={t('settings.ChannelsScreen.view_the_name_menu', { name: channel.name })} />
          </View>
          <SettingSwitch title={t('settings.ChannelsScreen.auto_accept_orders')}
            subtitle={linked ? t('settings.ChannelsScreen.new_orders_go_straight_to_the_kitchen') : t('settings.ChannelsScreen.orders_received_through_the_webhook_go')}
            value={draft.autoAccept} onValueChange={(v) => setDraft((d) => ({ ...d, autoAccept: v }))} />
          {dirty ? (
            <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <Button title={t('common.discard')} variant="secondary" size="sm" onPress={() => { setDraft(base); setServerErrors({}); }} disabled={saving} />
              <Button title={t('common.save')} size="sm" icon="checkmark" onPress={save} loading={saving} disabled={invalid} />
            </View>
          ) : null}
        </>
      ) : null}

      {WEBHOOK.includes(channel.code) ? (
        <>
          <Hairline />
          <Pressable onPress={() => setOpen((o) => !o)} accessibilityRole="button" accessibilityState={{ expanded: open }}
            accessibilityLabel={t('settings.ChannelsScreen.v_name_integration_details', { v: open ? t('common.hide') : t('common.show'), name: channel.name })}
            style={[{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 }, Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}>
            <Ionicons name="code-slash-outline" size={18} color={colors.textMuted} />
            <Text variant="smallStrong" style={{ flex: 1 }}>{t('settings.ChannelsScreen.integration_webhook')}</Text>
            <Text variant="small" tone="subtle">{isPhone ? '' : t('settings.ChannelsScreen.for_ondc_seller_apps_and_custom_bridges')}</Text>
            <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} />
          </Pressable>
          {open ? <Integration channel={channel} isOwner={isOwner} tenantId={tenantId} onSaved={onSaved} /> : null}
        </>
      ) : null}
      {menuOpen ? <ChannelMenuSheet channel={channel} symbol={symbol} onClose={() => setMenuOpen(false)} /> : null}
    </Card>
  );
}

function Suffix() {
  return <Text tone="muted" style={{ paddingRight: 12 }}>%</Text>;
}

function SwitchToggle({ value, onChange, disabled, label }: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  const { colors } = useTheme();
  return (
    <Switch value={value} onValueChange={onChange} disabled={disabled} accessibilityLabel={label}
      trackColor={{ true: colors.primary, false: colors.borderStrong }} />
  );
}

function Integration({ channel, isOwner, tenantId, onSaved }: { channel: SalesChannel; isOwner: boolean; tenantId: string; onSaved: (c: SalesChannel) => void }) {
  const { colors, radius } = useTheme();
  const [reveal, setReveal] = useState(false);
  const [rotating, setRotating] = useState(false);
  const url = `${apiBase()}/integrations/${channel.code.toLowerCase()}/orders/${tenantId}`;
  const secret = channel.webhook_secret ?? '';
  const masked = secret ? `${'•'.repeat(12)}${secret.slice(-4)}` : 'Not set';

  const rotate = async () => {
    const ok = await confirm({
      title: t('settings.ChannelsScreen.create_a_new_secret'),
      message: t('settings.ChannelsScreen.the_current_name_secret_stops_working', { name: channel.name }),
      confirmLabel: t('settings.ChannelsScreen.create_new_secret'),
      danger: true,
    });
    if (!ok) return;
    setRotating(true);
    try {
      const saved = await adminApi.rotateChannelSecret(channel.code);
      onSaved(saved);
      setReveal(true);
      toast.success(t('settings.ChannelsScreen.new_secret_created_update_it_in_your'));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setRotating(false);
    }
  };

  const box = { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceSunken, paddingHorizontal: 12, paddingVertical: 10 };

  return (
    <View style={{ gap: 14 }}>
      <Text variant="small" tone="muted">
        {AGGREGATORS.includes(channel.code) && channel.code !== 'ONDC'
          ? t('settings.ChannelsScreen.name_does_not_send_orders_to_this_url_by', { name: channel.name })
          : t('settings.ChannelsScreen.your_ondc_seller_app_website_or_a_small')}
      </Text>
      <View style={{ gap: 6 }}>
        <Text variant="smallStrong" tone="muted">{t('settings.ChannelsScreen.webhook_url_post_json')}</Text>
        <View style={[box, { flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
          <Text selectable style={{ flex: 1, fontFamily: monoFont, fontSize: 12.5, color: colors.text }}>{url}</Text>
          <Button icon="copy-outline" size="sm" variant="ghost" accessibilityLabel={t('settings.ChannelsScreen.copy_webhook_url')} onPress={() => copyText(url, 'Webhook URL')} />
        </View>
      </View>
      <View style={{ gap: 6 }}>
        <Text variant="smallStrong" tone="muted">{t('settings.ChannelsScreen.signing_secret')}</Text>
        <View style={[box, { flexDirection: 'row', alignItems: 'center', gap: 4 }]}>
          <Text selectable={reveal} style={{ flex: 1, fontFamily: monoFont, fontSize: 12.5, color: colors.text }} numberOfLines={reveal ? 3 : 1}>{reveal ? secret || t('common.not_set') : masked}</Text>
          <Button icon={reveal ? 'eye-off-outline' : 'eye-outline'} size="sm" variant="ghost" accessibilityLabel={reveal ? t('settings.ChannelsScreen.hide_secret') : t('settings.ChannelsScreen.show_secret')} onPress={() => setReveal((r) => !r)} disabled={!secret} />
          <Button icon="copy-outline" size="sm" variant="ghost" accessibilityLabel={t('settings.ChannelsScreen.copy_secret')} onPress={() => copyText(secret, 'Secret')} disabled={!secret} />
        </View>
        <Text variant="small" tone="subtle">
          {t('settings.ChannelsScreen.sign_each_request_header')} <Text variant="small" style={{ fontFamily: monoFont }}>{t('settings.ChannelsScreen.x_tallyko_signature')}</Text> {t('settings.ChannelsScreen.hex_hmac_sha256_of_the_raw_request_body')}
        </Text>
      </View>
      {isOwner ? (
        <Button title={t('settings.ChannelsScreen.create_new_secret')} icon="refresh" variant="secondary" size="sm" onPress={rotate} loading={rotating} style={{ alignSelf: 'flex-start' }} />
      ) : (
        <Text variant="small" tone="subtle">{t('settings.ChannelsScreen.only_the_owner_can_create_a_new_secret')}</Text>
      )}
      {!channel.enabled ? <Callout tone="warning">{t('settings.ChannelsScreen.name_is_off_so_orders_sent_to_this_url', { name: channel.name })}</Callout> : null}
    </View>
  );
}
