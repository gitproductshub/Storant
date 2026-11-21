import React from 'react';
import { View } from 'react-native';
import { Text } from './ui/Text';
import { Button } from './ui/Button';
import { brand } from '@/config/brand';
import { t } from '@/i18n';

interface State { error: Error | null }

/** Last line of defence: a render crash shows a recovery screen instead of a blank app. */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[${brand.name}] UI crash`, error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 }}>
        <Text variant="h2" align="center">{t('shell.ErrorBoundary.something_went_wrong_on_this_screen')}</Text>
        <Text tone="muted" align="center">{t('shell.ErrorBoundary.your_bills_are_safe_try_again_and_if_it')}</Text>
        <Button title={t('common.try_again')} icon="refresh" onPress={() => this.setState({ error: null })} />
      </View>
    );
  }
}
