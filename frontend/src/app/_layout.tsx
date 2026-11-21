import React, { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Font from 'expo-font';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold } from '@expo-google-fonts/inter';
import '@/i18n/sync';
import { ThemeProvider, useTheme } from '@/theme/ThemeProvider';
import { useAuth } from '@/store/auth';
import { usePrefs } from '@/store/prefs';
import { ToastHost, DialogHost } from '@/components/ui';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { RouteTitle } from '@/components/RouteTitle';

void SplashScreen.preventAutoHideAsync().catch(() => {});

// True after the first mount: a language switch remounts the tree, and icon fonts need a moment to settle (they flash as boxes).
let navigatorMountedBefore = false;

function Navigator() {
  const { colors, dark } = useTheme();
  const [cover, setCover] = useState(navigatorMountedBefore);
  useEffect(() => {
    navigatorMountedBefore = true;
    if (!cover) return undefined;
    const timer = setTimeout(() => setCover(false), 350);
    return () => clearTimeout(timer);
  }, [cover]);
  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const root = document.documentElement;
      root.setAttribute('data-theme', dark ? 'dark' : 'light');
      root.style.colorScheme = dark ? 'dark' : 'light';
      root.style.backgroundColor = colors.background;
      document.body.style.backgroundColor = colors.background;
      // Browser chrome (address bar / PWA title bar) follows the app theme, not just the OS theme
      document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove());
      const meta = document.createElement('meta');
      meta.name = 'theme-color';
      meta.content = colors.background;
      document.head.appendChild(meta);
    } else {
      void SystemUI.setBackgroundColorAsync(colors.background).catch(() => {});
    }
  }, [colors.background, dark]);
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <RouteTitle />
      <StatusBar style={dark ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(app)" />
        <Stack.Screen name="store/[tenantId]" />
        <Stack.Screen name="privacy" />
        <Stack.Screen name="delete-account" />
        <Stack.Screen name="subscription" options={{ gestureEnabled: false }} />
      </Stack>
      <ToastHost />
      <DialogHost />
      {cover ? <View pointerEvents="auto" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.background }} /> : null}
    </View>
  );
}

/** True once the saved theme/language prefs are read, so the first painted frame already uses the right theme. */
function usePrefsHydrated(): boolean {
  const [hydrated, setHydrated] = useState(() => usePrefs.persist.hasHydrated());
  useEffect(() => {
    if (usePrefs.persist.hasHydrated()) { setHydrated(true); return undefined; }
    return usePrefs.persist.onFinishHydration(() => setHydrated(true));
  }, []);
  return hydrated;
}

export default function RootLayout() {
  const prefsReady = usePrefsHydrated();
  const language = usePrefs((s) => s.language);
  // Fonts load in the background and never block the app: a slow or offline load used to surface as a "12000ms timeout" error.
  // The first paint waits at most 1.5 s for Inter, then falls back to the system font until it arrives.
  const [fontsReady, setFontsReady] = useState(false);
  useEffect(() => {
    const giveUp = setTimeout(() => setFontsReady(true), 1500);
    Font.loadAsync({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold })
      .catch(() => { /* system font fallback */ })
      .finally(() => { clearTimeout(giveUp); setFontsReady(true); });
    return () => clearTimeout(giveUp);
  }, []);
  const hydrate = useAuth((s) => s.hydrate);
  const status = useAuth((s) => s.status);

  useEffect(() => { void hydrate(); }, [hydrate]);

  const ready = fontsReady && status !== 'loading' && prefsReady;
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <ErrorBoundary>
            {/* Switching language remounts the tree so every screen re-reads its text */}
            <Navigator key={language} />
          </ErrorBoundary>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
