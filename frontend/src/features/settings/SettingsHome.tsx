import React, { useState } from 'react';
import { Platform, View } from 'react-native';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import { adminApi } from '@/api/endpoints';
import type { BusinessType } from '@/api/types';
import { Badge, Button, Card, ListRow, SectionTitle, StatusPill, Text, confirm } from '@/components/ui';
import { visibleNavItems } from '@/components/nav/navItems';
import { useAccessInfo } from '@/store/access';
import { endSession } from '@/lib/signOut';
import { useAccessLine } from '@/components/nav/shellStatus';
import { useApi } from '@/hooks/useApi';
import { can, useAuth } from '@/store/auth';
import { useData } from '@/store/data';
import { useOutbox } from '@/store/outbox';
import { usePrefs } from '@/store/prefs';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { SettingsFrame, SettingsSearch, useSettingsSections } from './SettingsFrame';
import { StatusDot, serverOrigin } from './components';
import { ROLE_LABEL } from './sections';
import { brand } from '@/config/brand';
import { t as tr } from '@/i18n';

const TYPE_LABEL: Record<BusinessType, string> = { get restaurant() { return tr('common.restaurant'); }, get cafe() { return tr('common.caf'); }, get cloud_kitchen() { return tr('common.cloud_kitchen'); }, get retail() { return tr('common.retail_shop'); } };

const go = (href: string) => router.push(href as Href);

export default function SettingsHome() {
  const { isDesktop, isWide } = useLayout();
  const session = useAuth((s) => s.session);
  const role = session?.role ?? null;
  const manager = can(role, 'manage');
  const settings = useData((s) => s.settings);
  const channels = useData((s) => s.channels);
  const printer = usePrefs((s) => s.printer);
  const theme = usePrefs((s) => s.theme);
  const businessName = settings?.business_name || session?.businessName || 'Your business';
  const liveChannels = channels.filter((c) => c.enabled && c.code !== 'POS').length;

  const sections = useSettingsSections();
  const access = useAccessInfo();
  // A role that can only open Kitchen and Settings (the kitchen role, or a custom one like it)
  const kitchenOnly = !!role && visibleNavItems(role, settings?.business_type, access).every((i) => i.route === 'kitchen' || i.route === 'settings');
  const [query, setQuery] = useState('');
  const accessLine = useAccessLine();
  const has = (key: string) => sections.some((x) => x.key === key);
  const extra = sections.filter((x) => ['taxes', 'qr', 'floor', 'kitchen', 'emails', 'modules', 'billing'].includes(x.key));

  return (
    <SettingsFrame active="overview" title={tr('common.settings')} subtitle={isDesktop ? tr('settings.SettingsHome.businessname_signed_in_as_v', { businessName, v: role ? ROLE_LABEL[role] : '' }) : businessName}>
      {!isWide ? <SettingsSearch query={query} onQuery={setQuery} sections={sections} onOpen={go} compact /> : null}

      {query.trim() && !isWide ? null : (
      <>
      {/* Kitchen devices (only Kitchen and Settings): signing out is one tap here, not at the bottom of Account */}
      {kitchenOnly ? <QuickSignOut /> : null}
      {manager ? <SetupChecklist /> : null}

      {!isWide ? (
        <>
          {manager && has('business') ? (
            <Group title={tr('common.business')}>
              <ListRow icon="storefront-outline" title={tr('settings.SettingsHome.business_profile')} subtitle={settings ? `${TYPE_LABEL[settings.business_type]} · ${settings.address || tr('settings.SettingsHome.no_address_yet')}` : tr('settings.SettingsHome.name_address_contact')}
                onPress={() => go('/settings/business?section=profile')} />
              <ListRow icon="document-text-outline" title={tr('settings.SettingsHome.gst_invoices')} subtitle={settings?.gstin ? tr('settings.SettingsHome.gstin_gstin', { gstin: settings.gstin }) : tr('settings.SettingsHome.gstin_fssai_tax_rate_bill_footer')}
                onPress={() => go('/settings/business?section=tax')} />
              <ListRow icon="qr-code-outline" title={tr('settings.SettingsHome.payments_upi')} subtitle={settings?.upi_id || tr('settings.SettingsHome.add_a_upi_id_for_payment_qr_on_bills')}
                onPress={() => go('/settings/business?section=payments')} />
              <ListRow icon="gift-outline" title={tr('common.loyalty')} subtitle={settings?.loyalty_enabled ? tr('settings.SettingsHome.on_loyalty_points_per_100_point_v_per_100', { loyalty_points_per_100: settings.loyalty_points_per_100, v: settings.loyalty_points_per_100 === 1 ? "" : "s" }) : tr('common.off')}
                onPress={() => go('/settings/business?section=loyalty')} />
              <ListRow icon="globe-outline" title={tr('settings.SettingsHome.online_ordering')} subtitle={onlineSummary(settings?.store_enabled, settings?.qr_ordering_enabled)}
                onPress={() => go('/settings/business?section=online')} />
            </Group>
          ) : null}

          <Group title={tr('common.this_device')}>
            <ListRow icon="print-outline" title={tr('common.printers_receipts')} subtitle={printer ? tr('settings.SettingsHome.bills_print_on_name', { name: printer.name }) : tr('settings.SettingsHome.using_the_print_dialog')} onPress={() => go('/settings/printers')} />
          </Group>

          {has('channels') || has('brands') || has('staff') ? (
            <Group title={tr('settings.SettingsHome.selling_team')}>
              {has('channels') ? <ListRow icon="git-network-outline" title={tr('common.sales_channels')} subtitle={liveChannels ? tr('settings.SettingsHome.livechannels_channel_v_on_swiggy_zomato', { liveChannels, v: liveChannels === 1 ? '' : 's' }) : tr('settings.SettingsHome.swiggy_zomato_ondc_magicpin_qr_store')}
                onPress={() => go('/settings/channels')} /> : null}
              {has('brands') ? <ListRow icon="pricetags-outline" title={tr('common.brands')} subtitle={tr('settings.SettingsHome.virtual_brands_for_cloud_kitchens')} onPress={() => go('/settings/brands')} /> : null}
              {has('staff') ? <ListRow icon="people-outline" title={tr('common.staff_roles')} subtitle={tr('settings.SettingsHome.logins_for_cashiers_waiters_and_kitchen')} onPress={() => go('/settings/staff')} /> : null}
            </Group>
          ) : null}

          {extra.length ? (
            <Group title={tr('settings.SettingsHome.more_settings')}>
              {extra.map((x) => (
                <ListRow key={x.key} icon={x.icon} title={x.label} subtitle={x.key === 'billing' && accessLine ? accessLine.label : x.description} onPress={() => go(x.href)}
                  right={x.key === 'billing' && accessLine ? <StatusPill status={accessLine.status} label={accessLine.status === 'development' ? tr('settings.SettingsHome.dev') : undefined} /> : undefined} />
              ))}
            </Group>
          ) : null}

          <Group title={tr('settings.SettingsHome.you')}>
            <ListRow icon="person-circle-outline" title={tr('common.account')} subtitle={tr('settings.SettingsHome.v_v2_theme', { v: session?.email ?? '', v2: theme === 'system' ? tr('common.system') : theme === 'dark' ? tr('settings.SettingsHome.dark') : tr('settings.SettingsHome.light') })}
              onPress={() => go('/settings/account')} />
          </Group>
        </>
      ) : (
        <QuickLinks manager={manager} printerName={printer?.name ?? null} liveChannels={liveChannels} />
      )}

      <About />
      </>
      )}
    </SettingsFrame>
  );
}

/** One-tap sign out for kitchen devices; asks first because signing out stops the kitchen's voice alerts. */
function QuickSignOut() {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    // Same warning as Settings → Account when this device still holds bills that haven't uploaded
    const tenantId = useAuth.getState().session?.tenantId;
    const pending = useOutbox.getState().queue.filter((q) => q.tenantId === tenantId).length;
    const ok = await confirm({
      title: tr('settings.SettingsHome.sign_out_of_this_device'),
      message: pending ? tr('app.signOut.pending', { pending }) : tr('settings.SettingsHome.sign_out_stops_kitchen_alerts'),
      confirmLabel: tr('common.sign_out'),
      danger: pending > 0,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await endSession(); // the same sign-out as Settings → Account
      router.replace('/login' as Href);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button title={tr('common.sign_out')} icon="log-out-outline" variant="secondary" size="lg" full loading={busy}
      onPress={() => void run()} testID="settings-quick-sign-out" />
  );
}

function onlineSummary(store?: boolean, qr?: boolean) {
  if (store && qr) return 'Online store and QR table ordering are on';
  if (store) return 'Online store is on';
  if (qr) return 'QR table ordering is on';
  return 'Own store and QR table ordering are off';
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 4 }}>
      <SectionTitle title={title} />
      <Card padded={false} style={{ padding: 4 }}>{children}</Card>
    </View>
  );
}

function SetupChecklist() {
  const { colors } = useTheme();
  const { isDesktop } = useLayout();
  const settings = useData((s) => s.settings);
  const printer = usePrefs((s) => s.printer);
  const staff = useApi(() => adminApi.staff(), [], { refetchOnFocus: true });
  if (!settings) return null;

  const items = [
    { key: 'profile', title: tr('settings.SettingsHome.add_your_address_and_phone'), detail: tr('settings.SettingsHome.printed_at_the_top_of_every_bill'), done: !!settings.address && !!settings.phone, href: '/settings/business?section=profile' },
    { key: 'gst', title: tr('settings.SettingsHome.add_gstin_and_fssai'), detail: tr('settings.SettingsHome.optional_if_you_are_not_gst_registered'), done: !!settings.gstin || !!settings.fssai, optional: true, href: '/settings/business?section=tax' },
    { key: 'upi', title: tr('settings.SettingsHome.add_your_upi_id'), detail: tr('settings.SettingsHome.customers_scan_the_qr_on_the_bill_to_pay'), done: !!settings.upi_id, href: '/settings/business?section=payments' },
    { key: 'printer', title: tr('settings.SettingsHome.connect_a_receipt_printer'), detail: tr('settings.SettingsHome.on_this_device_bills_use_the_print_dialog'), done: !!printer, optional: true, href: '/settings/printers' },
    { key: 'staff', title: tr('settings.SettingsHome.add_staff_logins'), detail: tr('settings.SettingsHome.so_each_bill_shows_who_made_it'), done: (staff.data?.length ?? 0) > 1, optional: true, href: '/settings/staff' },
    { key: 'online', title: tr('settings.SettingsHome.take_orders_online'), detail: tr('settings.SettingsHome.own_store_or_qr_table_ordering_with_no'), done: settings.store_enabled || settings.qr_ordering_enabled, optional: true, href: '/settings/business?section=online' },
  ];
  const done = items.filter((i) => i.done).length;
  const todo = items.filter((i) => !i.done);
  if (!isDesktop && todo.length === 0) return null;
  const shown = isDesktop ? items : todo.slice(0, 3);

  return (
    <Card style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="h3">{done === items.length ? tr('settings.SettingsHome.your_shop_is_fully_set_up') : tr('settings.SettingsHome.finish_setting_up')}</Text>
          <Text variant="small" tone="muted">{done} {tr('settings.SettingsHome.of_length_done', { length: items.length })}</Text>
        </View>
        {done === items.length ? <Badge label={tr('settings.SettingsHome.all_done')} tone="success" icon="checkmark" /> : null}
      </View>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.surfaceSunken, overflow: 'hidden' }}
        accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: items.length, now: done }}>
        <View style={{ width: `${(done / items.length) * 100}%`, height: 6, backgroundColor: colors.success }} />
      </View>
      <View style={{ gap: 0 }}>
        {shown.map((i) => (
          <ListRow key={i.key} title={i.title} subtitle={i.detail} left={<StatusDot ok={i.done} />}
            right={i.done ? <Text variant="small" tone="success">{tr('common.done')}</Text> : i.optional ? <Text variant="small" tone="subtle">{tr('common.optional')}</Text> : <Ionicons name="chevron-forward" size={18} color={colors.textSubtle} />}
            onPress={() => go(i.href)} />
        ))}
      </View>
    </Card>
  );
}

function QuickLinks({ manager, printerName, liveChannels }: { manager: boolean; printerName: string | null; liveChannels: number }) {
  const { colors } = useTheme();
  const tiles = [
    ...(manager ? [{ icon: 'storefront-outline' as const, title: tr('common.business'), detail: tr('settings.SettingsHome.profile_gst_upi_loyalty_online_ordering'), href: '/settings/business' }] : []),
    { icon: 'print-outline' as const, title: tr('common.printers_receipts'), detail: printerName ? tr('settings.SettingsHome.bills_print_on_printername', { printerName }) : tr('settings.SettingsHome.using_the_print_dialog'), href: '/settings/printers' },
    ...(manager ? [
      { icon: 'git-network-outline' as const, title: tr('common.sales_channels'), detail: liveChannels ? tr('settings.SettingsHome.livechannels_on', { liveChannels }) : tr('settings.SettingsHome.swiggy_zomato_ondc_magicpin'), href: '/settings/channels' },
      { icon: 'pricetags-outline' as const, title: tr('common.brands'), detail: tr('settings.SettingsHome.virtual_brands_for_cloud_kitchens'), href: '/settings/brands' },
      { icon: 'people-outline' as const, title: tr('common.staff_roles'), detail: tr('settings.SettingsHome.logins_and_permissions'), href: '/settings/staff' },
    ] : []),
    { icon: 'person-circle-outline' as const, title: tr('common.account'), detail: tr('settings.SettingsHome.password_appearance_sign_out'), href: '/settings/account' },
  ];
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
      {tiles.map((t) => (
        <Card key={t.href} onPress={() => router.replace(t.href as Href)} style={{ flexBasis: 260, flexGrow: 1, gap: 8 }}>
          <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name={t.icon} size={18} color={colors.primarySoftText} />
          </View>
          <Text variant="bodyStrong">{t.title}</Text>
          <Text variant="small" tone="muted" numberOfLines={2}>{t.detail}</Text>
        </Card>
      ))}
    </View>
  );
}

function About() {
  const version = Constants.expoConfig?.version ?? '—';
  const build = Platform.OS === 'ios' ? Constants.expoConfig?.ios?.buildNumber : Platform.OS === 'android' ? Constants.expoConfig?.android?.versionCode : null;
  const platform = Platform.OS === 'web' ? 'Web app' : Platform.OS === 'ios' ? 'iPhone / iPad app' : 'Android app';
  const customServer = usePrefs((s) => s.serverUrl);
  // Show the brand, not the hosting address; a server the user typed in themselves is still shown.
  const serverText = customServer ? serverOrigin() : brand.name;
  return (
    <Group title={tr('settings.SettingsHome.about')}>
      <ListRow icon="information-circle-outline" title={`${brand.name} ${version}${build ? ` (${build})` : ''}`} subtitle={platform} />
      <ListRow icon="server-outline" title={tr('settings.SettingsHome.server')} subtitle={serverText} />
      <ListRow icon="shield-checkmark-outline" title={tr('common.privacy_policy')} subtitle={tr('settings.SettingsHome.what_we_store_and_how_to_delete_it')} onPress={() => go('/privacy')} />
    </Group>
  );
}
