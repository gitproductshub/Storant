/**
 * Settings → Kitchen rules (owner only). When a bill may be paid, per order type ("Anytime" / "After items are ready" /
 * "After items are served"; business setting `pay_rules`), and whether Bump on the kitchen screen also marks dine-in food
 * served (`bump_marks_served`, for counter-service places without waiters). The server enforces both; the till mirrors
 * them (lib/payGate). Form logic in ./kitchenRules.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { api, errorMessage } from '@/api/client';
import type { BusinessSettings, OrderType, PayRule } from '@/api/types';
import { Button, EmptyState, ErrorState, Loading, SwitchRow, Text, toast } from '@/components/ui';
import { useApi } from '@/hooks/useApi';
import { useAuth } from '@/store/auth';
import { useAccessInfo } from '@/store/access';
import { useData } from '@/store/data';
import { ORDER_TYPE_UI } from '@/lib/uiLabels';
import { SettingsFrame } from './SettingsFrame';
import { Callout, ChoiceChips, FormSection, SaveBar } from './components';
import {
  PAY_RULES, kitchenRulesDefaults, kitchenRulesDirty, kitchenRulesFormOf, kitchenRulesPayload, orderTypesFor, type KitchenRulesForm,
} from './kitchenRules';
import { t } from '@/i18n';

const RULE_LABEL: Record<PayRule, () => string> = {
  anytime: () => t('settings.KitchenRulesScreen.rule_anytime'),
  ready: () => t('settings.KitchenRulesScreen.rule_ready'),
  served: () => t('settings.KitchenRulesScreen.rule_served'),
};

export default function KitchenRulesScreen() {
  const role = useAuth((s) => s.session?.role ?? null);
  if (role !== 'owner') {
    return (
      <SettingsFrame active="kitchen" title={t('settings.KitchenRulesScreen.kitchen_rules')}>
        <EmptyState icon="lock-closed-outline" title={t('settings.KitchenRulesScreen.owner_only')} message={t('settings.KitchenRulesScreen.ask_the_owner')} />
      </SettingsFrame>
    );
  }
  return <KitchenRulesSettings />;
}

function KitchenRulesSettings() {
  const { data, error, loading, reload, refreshing, setData } = useApi(() => api.get<BusinessSettings>('/settings'), []);
  const access = useAccessInfo();
  const kitchenOn = access ? access.features.includes('kitchen') : true;
  const types = useMemo(() => orderTypesFor(data), [data]);
  const initial = useMemo(() => (data ? kitchenRulesFormOf(data) : null), [data]);
  const [form, setForm] = useState<KitchenRulesForm | null>(null);
  const [saving, setSaving] = useState(false);

  // Follow fresh server data unless the owner is in the middle of editing
  const lastInitial = useRef<string | null>(null);
  useEffect(() => {
    if (!initial) return;
    const previous = lastInitial.current;
    lastInitial.current = JSON.stringify(initial);
    setForm((f) => (!f || previous === null || JSON.stringify(f) === previous ? initial : f));
  }, [initial]);

  const title = t('settings.KitchenRulesScreen.kitchen_rules');
  if (loading && !data) return <SettingsFrame active="kitchen" title={title}><Loading label={t('settings.KitchenRulesScreen.loading')} /></SettingsFrame>;
  if (!data || !form || !initial) {
    return <SettingsFrame active="kitchen" title={title}><ErrorState message={error ?? t('settings.KitchenRulesScreen.couldn_t_load')} onRetry={reload} /></SettingsFrame>;
  }

  const dirty = kitchenRulesDirty(form, initial, types);
  const defaults = kitchenRulesDefaults();
  const isDefault = !kitchenRulesDirty(form, defaults, types);
  const setRule = (type: OrderType) => (rule: PayRule) => setForm((f) => (f ? { ...f, rules: { ...f.rules, [type]: rule } } : f));

  const save = async () => {
    setSaving(true);
    try {
      const settings = await api.put<BusinessSettings>('/settings', kitchenRulesPayload(form, types));
      useData.getState().setSettings(settings); // the till reads the pay rules from here
      setData(settings);
      setForm(kitchenRulesFormOf(settings));
      toast.success(t('settings.KitchenRulesScreen.saved'));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsFrame active="kitchen" title={title} subtitle={t('settings.KitchenRulesScreen.subtitle')}
      dirty={dirty} refreshing={refreshing} onRefresh={reload}
      actions={!isDefault ? (
        <Button title={t('settings.KitchenRulesScreen.use_defaults')} size="sm" variant="ghost" icon="refresh-outline"
          onPress={() => setForm((f) => (f ? { ...f, rules: { ...f.rules, ...Object.fromEntries(types.map((ty) => [ty, defaults.rules[ty]])) }, bumpMarksServed: false } : f))} />
      ) : undefined}
      footer={<SaveBar visible={dirty} saving={saving} onSave={save} onDiscard={() => setForm(initial)} />}>
      {!kitchenOn ? (
        <Callout tone="warning" icon="restaurant-outline">{t('settings.KitchenRulesScreen.kitchen_module_off')}</Callout>
      ) : null}

      <FormSection title={t('settings.KitchenRulesScreen.when_a_bill_can_be_paid')} description={t('settings.KitchenRulesScreen.when_a_bill_can_be_paid_desc')}>
        <View style={{ gap: 16 }}>
          {types.map((type) => (
            <View key={type} style={{ gap: 8 }} testID={`kitchen-rule-${type}`}>
              <Text variant="bodyStrong">{ORDER_TYPE_UI[type] ?? type}</Text>
              <ChoiceChips<PayRule> value={form.rules[type]} onChange={setRule(type)} accessibilityLabel={ORDER_TYPE_UI[type] ?? type}
                options={PAY_RULES.map((r) => ({ value: r, label: RULE_LABEL[r]() }))} />
            </View>
          ))}
        </View>
      </FormSection>

      <Callout tone="info" icon="information-circle-outline" title={t('settings.KitchenRulesScreen.what_the_choices_mean')}>
        <View style={{ gap: 4 }}>
          <Text variant="small">{t('settings.KitchenRulesScreen.explain_anytime')}</Text>
          <Text variant="small">{t('settings.KitchenRulesScreen.explain_ready')}</Text>
          <Text variant="small">{t('settings.KitchenRulesScreen.explain_served')}</Text>
        </View>
      </Callout>
      <Callout tone="neutral" icon="shield-checkmark-outline">{t('settings.KitchenRulesScreen.note_pay_anyway')}</Callout>

      <FormSection title={t('settings.KitchenRulesScreen.kitchen_screen')} description={t('settings.KitchenRulesScreen.kitchen_screen_desc')}>
        <SwitchRow title={t('settings.KitchenRulesScreen.bump_marks_served')} subtitle={t('settings.KitchenRulesScreen.bump_marks_served_desc')}
          value={form.bumpMarksServed} onValueChange={(v) => setForm((f) => (f ? { ...f, bumpMarksServed: v } : f))} />
      </FormSection>
    </SettingsFrame>
  );
}
