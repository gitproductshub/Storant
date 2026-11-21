import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Platform, View } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import { Badge, Button, Card, Segmented, Text, confirm, toast } from '@/components/ui';
import {
  SYSTEM_PRINTER, PrinterError, disconnectPrinter, getCapabilities, printKot, printReceipt, requestPermissions, scanPrinters,
  type PrinterDevice, type PrinterKind,
} from '@/lib/print/printers';
import { buildKotText, buildReceiptText, type PaperWidth } from '@/lib/print/receipt';
import { printErrorMessage } from '@/lib/billing';
import { usePrefs } from '@/store/prefs';
import { can, useAuth } from '@/store/auth';
import { useData } from '@/store/data';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { SettingsFrame } from './SettingsFrame';
import { Callout, FormSection, Hairline, monoFont, SettingSwitch } from './components';
import { sampleKot, sampleReceipt } from './sample';
import { brand } from '@/config/brand';
import { t } from '@/i18n';

const KIND_LABEL: Record<PrinterKind, string> = {
  get 'bt-classic'() { return t('settings.PrintersScreen.bluetooth'); },
  get ble() { return t('settings.PrintersScreen.bluetooth_le'); },
  get 'web-bluetooth'() { return t('settings.PrintersScreen.web_bluetooth'); },
  get system() { return t('settings.PrintersScreen.print_dialog'); },
};

interface Env {
  kind: 'android' | 'ios' | 'expo-go' | 'web' | 'web-ios';
  title: string;
  summary: string;
  rows: { label: string; ok: boolean; detail: string }[];
  canScan: boolean;
}

function detectEnvironment(): Env {
  const caps = getCapabilities();
  if (Platform.OS === 'web') {
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    const iosBrowser = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && typeof document !== 'undefined' && 'ontouchend' in document);
    const secure = typeof window === 'undefined' || window.isSecureContext !== false;
    const rows = [
      {
        label: t('settings.PrintersScreen.bluetooth_printers_ble'),
        ok: caps.webBluetooth && secure,
        detail: caps.webBluetooth
          ? secure ? t('settings.PrintersScreen.chrome_edge_web_bluetooth_works_with_ble') : t('settings.PrintersScreen.needs_the_site_to_be_opened_over_https')
          : iosBrowser ? t('settings.PrintersScreen.no_browser_on_iphone_ipad_supports', { brand: brand.name }) : t('settings.PrintersScreen.this_browser_has_no_web_bluetooth_use'),
      },
      { label: t('settings.PrintersScreen.classic_bluetooth_printers'), ok: false, detail: t('settings.PrintersScreen.browsers_cannot_use_classic_bluetooth') },
      { label: t('settings.PrintersScreen.print_dialog'), ok: true, detail: t('settings.PrintersScreen.usb_wi_fi_and_network_printers_installed') },
    ];
    return {
      kind: iosBrowser ? 'web-ios' : 'web',
      title: iosBrowser ? t('settings.PrintersScreen.safari_iphone_browser') : t('settings.PrintersScreen.web_browser'),
      summary: caps.webBluetooth && secure
        ? t('settings.PrintersScreen.you_can_print_to_ble_printers_from_this')
        : t('settings.PrintersScreen.this_browser_prints_through_the_print', { brand: brand.name }),
      rows,
      canScan: caps.webBluetooth && secure,
    };
  }
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
    return {
      kind: 'expo-go',
      title: t('settings.PrintersScreen.expo_go_preview_app'),
      summary: t('settings.PrintersScreen.bluetooth_printing_does_not_work_inside', { brand: brand.name }),
      rows: [
        { label: t('settings.PrintersScreen.bluetooth_printers'), ok: false, detail: t('settings.PrintersScreen.needs_the_installed_brand_app', { brand: brand.name }) },
        { label: t('settings.PrintersScreen.print_dialog'), ok: true, detail: Platform.OS === 'ios' ? t('settings.PrintersScreen.airprint_printers_on_your_wi_fi') : t('settings.PrintersScreen.android_print_service_save_as_pdf') },
      ],
      canScan: false,
    };
  }
  if (Platform.OS === 'android') {
    return {
      kind: 'android',
      title: t('settings.PrintersScreen.android_app'),
      summary: caps.btClassic || caps.ble ? t('settings.PrintersScreen.pair_your_printer_in_android_bluetooth') : t('settings.PrintersScreen.bluetooth_modules_are_missing_from_this'),
      rows: [
        { label: t('settings.PrintersScreen.classic_bluetooth_printers'), ok: caps.btClassic, detail: caps.btClassic ? t('settings.PrintersScreen.most_58mm_80mm_thermal_printers_pair_them') : t('settings.PrintersScreen.not_included_in_this_build') },
        { label: t('settings.PrintersScreen.bluetooth_le_printers'), ok: caps.ble, detail: caps.ble ? t('settings.PrintersScreen.found_by_scanning_nearby') : t('settings.PrintersScreen.not_included_in_this_build') },
        { label: t('settings.PrintersScreen.print_dialog'), ok: true, detail: t('settings.PrintersScreen.android_print_service_wi_fi_printers_or') },
      ],
      canScan: caps.btClassic || caps.ble,
    };
  }
  return {
    kind: 'ios',
    title: t('settings.PrintersScreen.iphone_ipad_app'),
    summary: t('settings.PrintersScreen.ios_supports_bluetooth_le_printers_and'),
    rows: [
      { label: t('settings.PrintersScreen.bluetooth_le_printers'), ok: caps.ble, detail: caps.ble ? t('settings.PrintersScreen.found_by_scanning_nearby') : t('settings.PrintersScreen.not_included_in_this_build') },
      { label: t('settings.PrintersScreen.classic_bluetooth_printers'), ok: false, detail: t('settings.PrintersScreen.apple_does_not_allow_these_without_mfi') },
      { label: t('settings.PrintersScreen.airprint'), ok: true, detail: t('settings.PrintersScreen.any_airprint_printer_on_the_same_wi_fi') },
    ],
    canScan: caps.ble,
  };
}

export default function PrintersScreen() {
  const { colors } = useTheme();
  const { width, isPhone } = useLayout();
  const env = useMemo(detectEnvironment, []);
  const prefs = usePrefs();
  const setPrefs = usePrefs((s) => s.set);
  const settings = useData((s) => s.settings);
  const session = useAuth((s) => s.session);
  const isManager = can(session?.role ?? null, 'manage');

  const [scanning, setScanning] = useState(false);
  const [found, setFound] = useState<PrinterDevice[]>([]);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanned, setScanned] = useState(false);
  const [disclosed, setDisclosed] = useState(false);
  const [testing, setTesting] = useState<'bill' | 'kot' | null>(null);
  const [preview, setPreview] = useState<'bill' | 'kot'>('bill');

  const receipt = useMemo(() => sampleReceipt(settings, session?.businessName ?? null, session?.fullName ?? null), [settings, session?.businessName, session?.fullName]);
  const kot = useMemo(sampleKot, []);
  const previewText = useMemo(
    () => (preview === 'bill' ? buildReceiptText(receipt, prefs.paperWidth) : buildKotText(kot, prefs.paperWidth)),
    [preview, receipt, kot, prefs.paperWidth],
  );

  const billPrinter = prefs.printer ?? SYSTEM_PRINTER;
  const kitchenPrinter = prefs.kitchenPrinter;

  const find = async (showAllDevices = false) => {
    setScanError(null);
    // Prominent disclosure before the Android runtime permission prompt (Play policy).
    if (Platform.OS === 'android' && !disclosed) {
      const ok = await confirm({
        title: t('settings.PrintersScreen.allow_bluetooth_for_printing'),
        message: t('settings.PrintersScreen.brand_uses_bluetooth_nearby_devices_only', { brand: brand.name }),
        confirmLabel: t('common.continue'),
      });
      if (!ok) return;
      setDisclosed(true);
      const granted = await requestPermissions();
      if (!granted) {
        setScanError(new PrinterError('PERMISSION_DENIED').message);
        return;
      }
    }
    setScanning(true);
    try {
      const list = await scanPrinters(8000, { showAllDevices });
      setScanned(true);
      if (Platform.OS === 'web') {
        if (list.length === 0) {
          toast.info(t('settings.PrintersScreen.no_printer_was_chosen'));
          return;
        }
        setFound((prev) => [...list, ...prev.filter((p) => !list.some((l) => l.id === p.id))]);
      } else {
        setFound(list);
      }
    } catch (e) {
      const message = printErrorMessage(e);
      setScanError(message);
      if (!(e instanceof PrinterError && e.code === 'CANCELLED')) toast.error(message);
    } finally {
      setScanning(false);
    }
  };

  const assign = async (target: 'bill' | 'kitchen', device: PrinterDevice | null) => {
    const previous = target === 'bill' ? prefs.printer : prefs.kitchenPrinter;
    if (previous && previous.kind !== 'system' && previous.id !== device?.id) {
      const stillUsed = target === 'bill' ? prefs.kitchenPrinter?.id === previous.id : prefs.printer?.id === previous.id;
      if (!stillUsed) await disconnectPrinter(previous);
    }
    setPrefs(target === 'bill' ? { printer: device } : { kitchenPrinter: device });
    const name = device ? device.name : target === 'bill' ? 'the print dialog' : 'the bill printer';
    toast.success(target === 'bill' ? t('settings.PrintersScreen.bills_will_print_on_name', { name }) : t('settings.PrintersScreen.kitchen_tickets_will_print_on_name', { name }));
  };

  const testBill = async () => {
    setTesting('bill');
    try {
      await printReceipt(prefs.printer, receipt, prefs.paperWidth, { barcode: prefs.printBarcodeOnBill, qr: prefs.printQrOnBill, openDrawer: false });
      if (prefs.printer && prefs.printer.kind !== 'system') toast.success(t('settings.PrintersScreen.test_bill_sent_to_the_printer'));
    } catch (e) {
      toast.error(printErrorMessage(e));
    } finally {
      setTesting(null);
    }
  };

  const testKot = async () => {
    setTesting('kot');
    try {
      const device = prefs.kitchenPrinter ?? prefs.printer;
      await printKot(device, kot, prefs.paperWidth);
      if (device && device.kind !== 'system') toast.success(t('settings.PrintersScreen.test_kitchen_ticket_sent_to_the_printer'));
    } catch (e) {
      toast.error(printErrorMessage(e));
    } finally {
      setTesting(null);
    }
  };

  const sideBySide = width >= 1320;

  const capabilityCard = (
    <Card style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={env.kind.startsWith('web') ? 'globe-outline' : 'phone-portrait-outline'} size={20} color={colors.primarySoftText} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="caption" tone="subtle" style={{ textTransform: 'uppercase' }}>{t('common.this_device')}</Text>
          <Text variant="h3">{env.title}</Text>
        </View>
      </View>
      <Text tone="muted">{env.summary}</Text>
      <View style={{ gap: 10 }}>
        {env.rows.map((r) => (
          <View key={r.label} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
            <Ionicons name={r.ok ? 'checkmark-circle' : 'close-circle'} size={18} color={r.ok ? colors.success : colors.textSubtle} style={{ marginTop: 2 }} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text variant="smallStrong">{r.label}</Text>
              <Text variant="small" tone="muted">{r.detail}</Text>
            </View>
          </View>
        ))}
      </View>
    </Card>
  );

  const printerRow = (label: string, device: PrinterDevice | null, fallback: string, actions: React.ReactNode) => (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={device && device.kind !== 'system' ? 'bluetooth' : 'print-outline'} size={20} color={colors.textMuted} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="small" tone="muted">{label}</Text>
          <Text variant="bodyStrong" numberOfLines={1}>{device ? device.name : fallback}</Text>
        </View>
        {device ? <Badge label={KIND_LABEL[device.kind]} tone={device.kind === 'system' ? 'neutral' : 'primary'} /> : null}
      </View>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>{actions}</View>
    </View>
  );

  const previewCard = (
    <Card style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <Text variant="h3">{t('common.preview')}</Text>
        <View style={{ width: 200 }}>
          <Segmented size="sm" value={preview} onChange={setPreview} options={[{ value: 'bill', label: t('common.bill') }, { value: 'kot', label: t('common.kitchen') }]} />
        </View>
      </View>
      <View style={{ alignItems: 'center', backgroundColor: colors.surfaceSunken, borderRadius: 12, paddingVertical: 16, paddingHorizontal: 8 }}>
        <View
          accessibilityLabel={preview === 'bill' ? t('settings.PrintersScreen.sample_bill_preview') : t('settings.PrintersScreen.sample_kitchen_ticket_preview')}
          style={{ backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, paddingVertical: 14, paddingHorizontal: 12, borderRadius: 4, maxWidth: '100%' }}
        >
          <Text selectable style={{ fontFamily: monoFont, fontSize: prefs.paperWidth === 58 ? 12 : 10.5, lineHeight: prefs.paperWidth === 58 ? 16 : 14, color: colors.text }}>
            {previewText}
          </Text>
        </View>
      </View>
      <Text variant="small" tone="subtle">
        {t('settings.PrintersScreen.how_a_paperwidth_mm_bluetooth_printer', { paperWidth: prefs.paperWidth })}{prefs.printBarcodeOnBill || prefs.printQrOnBill ? t('settings.PrintersScreen.barcode_and_qr_are_printed_as_images') : ''}{t('settings.PrintersScreen.the_print_dialog_uses_a_cleaner_layout')}
      </Text>
    </Card>
  );

  return (
    <SettingsFrame active="printers" title={t('common.printers_receipts')} subtitle={t('settings.PrintersScreen.saved_on_this_device_only_set_up_each')} maxWidth={sideBySide ? 1180 : 960}>
      <View style={{ flexDirection: sideBySide ? 'row' : 'column', gap: 24, alignItems: 'flex-start' }}>
        <View style={{ flex: 1, gap: 24, minWidth: 0, width: sideBySide ? undefined : '100%' }}>
          {capabilityCard}

          <Callout tone="info" icon="bluetooth" title={t('settings.PrintersScreen.about_bluetooth_printing')}>
            {t('settings.PrintersScreen.bluetooth_printing_needs_the_brand_app', { brand: brand.name })}
          </Callout>

          <FormSection stacked title={t('settings.PrintersScreen.your_printers')} description={t('settings.PrintersScreen.bills_go_to_the_bill_printer_kitchen')}>
            {printerRow('Bill printer', billPrinter, 'Print dialog', (
              <>
                <Button title={t('settings.PrintersScreen.test_bill')} size="sm" icon="receipt-outline" onPress={testBill} loading={testing === 'bill'} disabled={testing !== null} />
                {prefs.printer ? <Button title={t('settings.PrintersScreen.use_print_dialog_instead')} size="sm" variant="ghost" onPress={() => assign('bill', null)} disabled={testing !== null} /> : null}
              </>
            ))}
            {prefs.printer?.kind === 'web-bluetooth' ? (
              <Text variant="small" tone="subtle">{t('settings.PrintersScreen.browsers_forget_bluetooth_printers_after')}</Text>
            ) : null}
            <Hairline />
            {printerRow('Kitchen printer (KOT)', kitchenPrinter, `Same as bill printer (${billPrinter.name})`, (
              <>
                <Button title={t('settings.PrintersScreen.test_kitchen_ticket')} size="sm" variant="secondary" icon="flame-outline" onPress={testKot} loading={testing === 'kot'} disabled={testing !== null} />
                {kitchenPrinter ? <Button title={t('settings.PrintersScreen.same_as_bill_printer')} size="sm" variant="ghost" onPress={() => assign('kitchen', null)} /> : null}
                {kitchenPrinter?.kind !== 'system' ? <Button title={t('settings.PrintersScreen.use_print_dialog')} size="sm" variant="ghost" onPress={() => assign('kitchen', SYSTEM_PRINTER)} /> : null}
              </>
            ))}
          </FormSection>

          <FormSection
            stacked
            title={t('settings.PrintersScreen.find_printers')}
            description={Platform.OS === 'web'
              ? t('settings.PrintersScreen.switch_the_printer_on_then_choose_it_in')
              : Platform.OS === 'android'
                ? t('settings.PrintersScreen.switch_the_printer_on_and_pair_it_in')
                : t('settings.PrintersScreen.switch_the_printer_on_and_keep_it_close')}
          >
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <Button title={Platform.OS === 'web' ? t('settings.PrintersScreen.choose_bluetooth_printer') : scanned ? t('settings.PrintersScreen.search_again') : t('settings.PrintersScreen.find_printers')} icon="search"
                onPress={() => find(false)} loading={scanning} disabled={!env.canScan || scanning} />
              {Platform.OS === 'web' && env.canScan ? (
                <Button title={t('settings.PrintersScreen.show_all_devices')} variant="ghost" size="sm" onPress={() => find(true)} disabled={scanning} />
              ) : null}
            </View>
            {!env.canScan ? (
              <Text variant="small" tone="muted">{t('settings.PrintersScreen.bluetooth_isn_t_available_here_you_can')}</Text>
            ) : Platform.OS === 'web' ? (
              <Text variant="small" tone="subtle">{t('settings.PrintersScreen.printer_not_in_the_list_tap_show_all')}</Text>
            ) : null}
            {scanning && Platform.OS !== 'web' ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <ActivityIndicator color={colors.primary} />
                <Text tone="muted">{t('settings.PrintersScreen.looking_for_printers_nearby_about_8')}</Text>
              </View>
            ) : null}
            {scanError ? <Callout tone="danger" title={t('settings.PrintersScreen.couldn_t_find_printers')}>{scanError}</Callout> : null}
            {scanned && !scanning && !scanError && found.length === 0 ? (
              <Callout tone="warning" title={t('settings.PrintersScreen.no_printers_found')}>
                {t('settings.PrintersScreen.make_sure_the_printer_is_on_charged_and')}
              </Callout>
            ) : null}
            {found.length > 0 ? (
              <View style={{ gap: 8 }}>
                {found.map((d) => {
                  const isBill = prefs.printer?.id === d.id;
                  const isKitchen = prefs.kitchenPrinter?.id === d.id;
                  return (
                    <View key={d.id} style={{ borderWidth: 1, borderColor: isBill || isKitchen ? colors.primary : colors.border, borderRadius: 12, padding: 12, gap: 10 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                        <Ionicons name="print" size={20} color={colors.textMuted} />
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text variant="bodyStrong" numberOfLines={1}>{d.name}</Text>
                          <Text variant="small" tone="subtle" numberOfLines={1}>{KIND_LABEL[d.kind]}{d.address ? ` · ${d.address}` : ''}</Text>
                        </View>
                        {isBill ? <Badge label={t('common.bills')} tone="success" icon="checkmark" /> : null}
                        {isKitchen ? <Badge label={t('common.kitchen')} tone="success" icon="checkmark" /> : null}
                      </View>
                      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                        <Button title={isBill ? t('settings.PrintersScreen.bill_printer') : t('settings.PrintersScreen.use_for_bills')} size="sm" variant={isBill ? 'soft' : 'secondary'} disabled={isBill}
                          onPress={() => assign('bill', d)} />
                        <Button title={isKitchen ? t('settings.PrintersScreen.kitchen_printer') : t('settings.PrintersScreen.use_for_kitchen')} size="sm" variant={isKitchen ? 'soft' : 'secondary'} disabled={isKitchen}
                          onPress={() => assign('kitchen', d)} />
                      </View>
                    </View>
                  );
                })}
              </View>
            ) : null}
          </FormSection>

          <FormSection stacked title={t('settings.PrintersScreen.receipt_options')} description={t('settings.PrintersScreen.how_bills_look_and_what_happens_after')}>
            <View style={{ gap: 6 }}>
              <Text variant="smallStrong" tone="muted">{t('settings.PrintersScreen.paper_width')}</Text>
              <View style={{ maxWidth: 320 }}>
                <Segmented<'58' | '80'>
                  value={String(prefs.paperWidth) as '58' | '80'}
                  onChange={(v) => setPrefs({ paperWidth: Number(v) as PaperWidth })}
                  options={[{ value: '58', label: t('settings.PrintersScreen.58_mm_2_inch') }, { value: '80', label: t('settings.PrintersScreen.80_mm_3_inch') }]}
                />
              </View>
              <Text variant="small" tone="subtle">{t('settings.PrintersScreen.check_the_paper_roll_most_small_handheld')}</Text>
            </View>
            <Hairline />
            <SettingSwitch title={t('settings.PrintersScreen.print_bill_after_payment')} subtitle={t('settings.PrintersScreen.prints_automatically_when_a_bill_is_paid')}
              value={prefs.autoPrintReceipt} onValueChange={(v) => setPrefs({ autoPrintReceipt: v })} />
            <SettingSwitch title={t('settings.PrintersScreen.print_kitchen_ticket_kot')} subtitle={t('settings.PrintersScreen.prints_a_kot_when_items_are_sent_to_the')}
              value={prefs.autoPrintKot} onValueChange={(v) => setPrefs({ autoPrintKot: v })} />
            <SettingSwitch title={t('settings.PrintersScreen.barcode_on_bill')} subtitle={t('settings.PrintersScreen.scan_the_bill_later_to_find_it_quickly')}
              value={prefs.printBarcodeOnBill} onValueChange={(v) => setPrefs({ printBarcodeOnBill: v })} />
            <SettingSwitch title={t('settings.PrintersScreen.upi_qr_on_bill')}
              subtitle={settings?.upi_id ? t('settings.PrintersScreen.customers_scan_to_pay_upi_id_turn_off_if', { upi_id: settings.upi_id }) : t('settings.PrintersScreen.add_a_upi_id_in_business_settings_to')}
              value={prefs.printQrOnBill} onValueChange={(v) => setPrefs({ printQrOnBill: v })} />
            {!settings?.upi_id && isManager ? (
              <Button title={t('settings.PrintersScreen.add_upi_id')} size="sm" variant="ghost" iconRight="arrow-forward" style={{ alignSelf: 'flex-start' }}
                onPress={() => router.navigate('/settings/business?section=payments' as Href)} />
            ) : null}
            <SettingSwitch title={t('settings.PrintersScreen.open_cash_drawer')} subtitle={t('settings.PrintersScreen.kicks_a_cash_drawer_plugged_into_a')}
              value={prefs.openCashDrawer} onValueChange={(v) => setPrefs({ openCashDrawer: v })} />
          </FormSection>

          {!sideBySide ? previewCard : null}
          {isPhone ? null : <View style={{ height: 8 }} />}
        </View>
        {sideBySide ? <View style={{ width: 400, gap: 16 }}>{previewCard}</View> : null}
      </View>
    </SettingsFrame>
  );
}
