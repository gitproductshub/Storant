/** Every change Storant staff made on the platform: who, what, which business, when. */
import React, { useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { platformApi, type AuditEntry } from '@/api/platform';
import { Card, Chip, EmptyState, ErrorState, Input, Loading, Segmented, Text } from '@/components/ui';
import { useApi } from '@/hooks/useApi';
import { formatDateTime } from '@/lib/format';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { monoFont } from '@/features/settings/components';
import { AdminPage, actionLabel, goTo } from './shared';
import { brand } from '@/config/brand';
import { t } from '@/i18n';

type Size = '100' | '250' | '500';

function detailsText(details: Record<string, unknown> | null): string {
  if (!details) return '';
  return Object.entries(details)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => {
      const value = Array.isArray(v) ? (v.length > 5 ? `${v.length} items` : v.join(', ')) : typeof v === 'object' ? JSON.stringify(v) : String(v);
      return `${k.replace(/_/g, ' ')}: ${value}`;
    })
    .join(' · ');
}

export default function AuditScreen() {
  const { width } = useLayout();
  const [size, setSize] = useState<Size>('100');
  const [action, setAction] = useState<string>('all');
  const [query, setQuery] = useState('');
  const { data, error, loading, refreshing, reload } = useApi(() => platformApi.audit({ limit: Number(size) }), [size]);

  const actions = useMemo(() => [...new Set((data ?? []).map((e) => e.action))].sort(), [data]);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data ?? []).filter((e) => (action === 'all' || e.action === action)
      && (!q || [e.actor_email, e.action, actionLabel(e.action), e.business_id ?? '', detailsText(e.details)].some((s) => s.toLowerCase().includes(q))));
  }, [data, action, query]);
  const table = width >= 1000;

  return (
    <AdminPage
      title={t('admin.AuditScreen.audit_log')}
      subtitle={t('admin.AuditScreen.platform_actions_by_brand_staff', { brand: brand.name })}
      refreshing={refreshing}
      onRefresh={reload}
      toolbar={
        <View style={{ gap: 10 }}>
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <View style={{ flex: 1, minWidth: 220 }}>
              <Input value={query} onChangeText={setQuery} icon="search" placeholder={t('admin.AuditScreen.filter_by_person_business_id_or_detail')} autoCapitalize="none" autoCorrect={false}
                accessibilityLabel={t('admin.AuditScreen.filter_audit_log')} />
            </View>
            <View style={{ width: 240 }}>
              <Segmented size="sm" value={size} onChange={setSize}
                options={[{ value: '100', label: t('admin.AuditScreen.last_100') }, { value: '250', label: '250' }, { value: '500', label: '500' }]} />
            </View>
          </View>
          {actions.length > 1 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              <Chip label={t('admin.AuditScreen.all_actions')} selected={action === 'all'} onPress={() => setAction('all')} />
              {actions.map((a) => <Chip key={a} label={actionLabel(a)} selected={action === a} onPress={() => setAction(a)} />)}
            </ScrollView>
          ) : null}
        </View>
      }
    >
      {loading && !data ? <Loading label={t('admin.AuditScreen.loading_audit_log')} /> : null}
      {error && !data ? <ErrorState message={error} onRetry={reload} /> : null}
      {data && data.length === 0 ? <EmptyState icon="time-outline" title={t('admin.AuditScreen.no_platform_actions_yet')} message={t('admin.AuditScreen.changes_made_in_this_console_are_recorded')} /> : null}
      {data && data.length > 0 && rows.length === 0 ? (
        <EmptyState icon="search-outline" title={t('admin.AuditScreen.nothing_matches')} message={t('admin.AuditScreen.try_another_filter')} action={{ label: t('common.clear_filters'), icon: 'close-circle-outline', onPress: () => { setQuery(''); setAction('all'); } }} />
      ) : null}
      {rows.length ? (
        <Card padded={false} style={{ overflow: 'hidden' }}>
          {table ? <Header /> : null}
          {rows.map((e, i) => (table ? <TableRow key={e.id} entry={e} first={i === 0} /> : <CompactRow key={e.id} entry={e} first={i === 0} />))}
        </Card>
      ) : null}
      {data && data.length >= Number(size) ? (
        <Text variant="small" tone="subtle" align="center">{t('admin.AuditScreen.showing_the_latest_size_actions_choose_a', { size })}</Text>
      ) : null}
    </AdminPage>
  );
}

const COLS = { when: 1.2, who: 1.6, what: 1.4, business: 1.1, details: 3 };

function Header() {
  const { colors } = useTheme();
  const head = (label: string, flex: number) => <Text variant="caption" tone="subtle" style={{ flex, textTransform: 'uppercase' }}>{label}</Text>;
  return (
    <View style={[styles.tr, { backgroundColor: colors.surfaceAlt, borderBottomWidth: 1, borderBottomColor: colors.border, minHeight: 40 }]}>
      {head('When', COLS.when)}
      {head('Who', COLS.who)}
      {head('Action', COLS.what)}
      {head('Business', COLS.business)}
      {head('Details', COLS.details)}
    </View>
  );
}

function BusinessLink({ id }: { id: string | null }) {
  if (!id) return <Text variant="small" tone="subtle">{t('admin.AuditScreen.platform')}</Text>;
  return (
    <Pressable onPress={() => goTo(`/admin/businesses/${id}`)} accessibilityRole="link" accessibilityLabel={t('common.open_business')}
      style={({ hovered }: any) => [hovered && { opacity: 0.7 }, Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}>
      <Text variant="small" tone="primary" style={{ fontFamily: monoFont }} numberOfLines={1}>{id.slice(0, 8)}…</Text>
    </Pressable>
  );
}

function TableRow({ entry: e, first }: { entry: AuditEntry; first: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.tr, { borderTopWidth: first ? 0 : 1, borderTopColor: colors.divider }]}>
      <Text variant="small" tone="muted" style={{ flex: COLS.when }}>{formatDateTime(e.created_at)}</Text>
      <Text variant="small" style={{ flex: COLS.who }} numberOfLines={1}>{e.actor_email}</Text>
      <Text variant="smallStrong" style={{ flex: COLS.what }} numberOfLines={2}>{actionLabel(e.action)}</Text>
      <View style={{ flex: COLS.business }}><BusinessLink id={e.business_id} /></View>
      <Text variant="small" tone="muted" style={{ flex: COLS.details }} numberOfLines={3} selectable>{detailsText(e.details) || '—'}</Text>
    </View>
  );
}

function CompactRow({ entry: e, first }: { entry: AuditEntry; first: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.compact, { borderTopWidth: first ? 0 : 1, borderTopColor: colors.divider }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text variant="smallStrong" style={{ flex: 1 }} numberOfLines={1}>{actionLabel(e.action)}</Text>
        <Text variant="caption" tone="subtle">{formatDateTime(e.created_at)}</Text>
      </View>
      {detailsText(e.details) ? <Text variant="small" tone="muted" numberOfLines={3}>{detailsText(e.details)}</Text> : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text variant="caption" tone="subtle" style={{ flex: 1 }} numberOfLines={1}>{e.actor_email}</Text>
        <BusinessLink id={e.business_id} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tr: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  compact: { gap: 4, paddingHorizontal: 16, paddingVertical: 12 },
});
