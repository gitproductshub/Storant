/**
 * The server refused a bill because items are sold out or short (409 STOCK_SHORT, decided under a row lock, so this
 * is the real number even when two tills sold at once). Fix the bill to what is left, or — owner / manager only —
 * sell anyway with a reason (audited on the server).
 */
import React from 'react';
import { View } from 'react-native';
import { Button, Sheet, Text } from '@/components/ui';
import type { StockShortItem } from '@/lib/stock';
import { t } from '@/i18n';

export function StockShortSheet({ items, canSellAnyway, onFix, onSellAnyway, onClose }: {
  items: StockShortItem[] | null; canSellAnyway: boolean; onFix: () => void; onSellAnyway: () => void; onClose: () => void;
}) {
  return (
    <Sheet visible={!!items} onClose={onClose} title={t('stock.sheet_title')} subtitle={t('stock.sheet_subtitle')}
      footer={(
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end' }}>
          <Button title={t('common.cancel')} variant="ghost" onPress={onClose} />
          {canSellAnyway ? <Button title={t('stock.sell_anyway')} icon="alert-circle-outline" variant="secondary" onPress={onSellAnyway} /> : null}
          <Button title={t('stock.fix_bill')} icon="checkmark" variant="primary" onPress={onFix} testID="stock-fix-bill" />
        </View>
      )}>
      <View style={{ gap: 10 }}>
        {(items ?? []).map((item) => {
          const left = typeof item.available === 'number' ? item.available : 0;
          return (
            <View key={item.product_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={2}>{item.name}</Text>
              <Text variant="small" tone={left > 0 ? 'warning' : 'danger'}>
                {left > 0
                  ? t('stock.left_of_asked', { left, asked: item.requested ?? left })
                  : t('stock.sold_out')}
              </Text>
            </View>
          );
        })}
        <Text variant="small" tone="muted">{left0(items) ? t('stock.fix_removes') : t('stock.fix_sets')}</Text>
      </View>
    </Sheet>
  );
}

function left0(items: StockShortItem[] | null): boolean {
  return !!items?.some((i) => !(typeof i.available === 'number' && i.available > 0));
}
