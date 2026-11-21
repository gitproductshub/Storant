import React from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { Text } from './ui';
import { ThemeToggle } from '@/theme/ThemeToggle';
import { LanguageMenu } from '@/i18n/LanguageSwitcher';
import { Logo } from './Logo';
import { t } from '@/i18n';

const POINTS: { icon: keyof typeof Ionicons.glyphMap; title: string; body: string }[] = [
  { icon: 'flash-outline', get title() { return t('shell.AuthLayout.bill_in_seconds'); }, get body() { return t('shell.AuthLayout.tap_pay_print_gst_upi_and_split_payments'); } },
  { icon: 'cloud-offline-outline', get title() { return t('shell.AuthLayout.works_offline'); }, get body() { return t('shell.AuthLayout.internet_down_keep_billing_everything'); } },
  { icon: 'restaurant-outline', get title() { return t('shell.AuthLayout.tables_kitchen_online_orders'); }, get body() { return t('shell.AuthLayout.kots_swiggy_zomato_orders_and_qr_menus_in'); } },
  { icon: 'camera-outline', get title() { return t('shell.AuthLayout.menu_from_a_photo'); }, get body() { return t('shell.AuthLayout.snap_any_printed_menu_and_import_items'); } },
];

export function AuthLayout({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  const { isWide } = useLayout();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.root, { backgroundColor: colors.background, flexDirection: isWide ? 'row' : 'column' }]}>
      {isWide ? (
        <View style={[styles.brand, { backgroundColor: colors.sidebar, borderRightWidth: 1, borderRightColor: colors.sidebarBorder }]}>
          <Logo inverse size={34} />
          <View style={{ gap: 10, marginTop: 56 }}>
            <Text variant="display" color={colors.sidebarText} style={{ maxWidth: 440 }}>{t('shell.AuthLayout.the_point_of_sale_that_keeps_your_shop')}</Text>
            <Text color={colors.sidebarMuted} style={{ maxWidth: 420 }}>{t('shell.AuthLayout.for_restaurants_caf_s_cloud_kitchens_and')}</Text>
          </View>
          <View style={{ gap: 22, marginTop: 44 }}>
            {POINTS.map((p) => (
              <View key={p.title} style={{ flexDirection: 'row', gap: 14, maxWidth: 440 }}>
                <View style={[styles.pointIcon, { backgroundColor: colors.sidebarActive }]}>
                  <Ionicons name={p.icon} size={20} color={colors.sidebarActiveText} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text variant="bodyStrong" color={colors.sidebarText}>{p.title}</Text>
                  <Text variant="small" color={colors.sidebarMuted}>{p.body}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>
      ) : null}
      <View style={{ position: 'absolute', top: insets.top + 12, right: 16, zIndex: 5, flexDirection: 'row', alignItems: 'center', gap: 4 }}><LanguageMenu /><ThemeToggle /></View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={[styles.formWrap, { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 32 }]} keyboardShouldPersistTaps="handled">
          <View style={styles.form}>
            {!isWide ? <Logo size={30} /> : null}
            {children}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  brand: { width: '44%', maxWidth: 620, padding: 56, justifyContent: 'center' },
  pointIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  formWrap: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 20 },
  form: { width: '100%', maxWidth: 420, alignSelf: 'center', gap: 18 },
});
