import React, { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useTheme } from '@/theme/ThemeProvider';
import { Button, Input, Loading, Sheet, Text } from '@/components/ui';
import { barcodeError } from './utils';
import { brand } from '@/config/brand';
import { t } from '@/i18n';

/**
 * Scan a product barcode with the device camera. Also offers manual entry, since USB/Bluetooth
 * scanners simply "type" the code into the focused field.
 */
export function BarcodeScanSheet({ visible, onClose, onScanned }: {
  visible: boolean; onClose: () => void; onScanned: (code: string) => void;
}) {
  const { colors } = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [available, setAvailable] = useState<boolean | null>(Platform.OS === 'web' ? null : true);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manual, setManual] = useState('');
  const handled = useRef(false);

  useEffect(() => {
    if (!visible) return;
    handled.current = false;
    setManual('');
    setCameraError(null);
    if (Platform.OS === 'web') {
      CameraView.isAvailableAsync().then(setAvailable).catch(() => setAvailable(false));
    }
  }, [visible]);

  const onBarcode = (r: BarcodeScanningResult) => {
    const code = (r.data ?? '').trim();
    if (handled.current || !code) return;
    handled.current = true;
    onScanned(code);
  };

  const manualError = manual ? barcodeError(manual) : null;
  const submitManual = () => {
    if (!manual.trim() || manualError) return;
    onScanned(manual.trim());
  };

  let body: React.ReactNode;
  if (available === null || !permission) {
    body = <Loading label={t('catalog.BarcodeScanSheet.starting_camera')} />;
  } else if (!available) {
    body = <Notice text={t('catalog.BarcodeScanSheet.no_camera_was_found_on_this_device_type_x')} />;
  } else if (!permission.granted) {
    body = (
      <View style={[styles.frame, { backgroundColor: colors.surfaceSunken, gap: 12, padding: 20 }]}>
        <Text variant="h3" align="center">{t('catalog.BarcodeScanSheet.allow_camera_access')}</Text>
        <Text tone="muted" align="center">{brand.name} {t('catalog.BarcodeScanSheet.uses_the_camera_only_to_read_the_barcode')}</Text>
        {permission.canAskAgain || Platform.OS === 'web' ? (
          <Button title={t('catalog.BarcodeScanSheet.allow_camera')} icon="camera-outline" onPress={() => void requestPermission()} />
        ) : (
          <Text tone="warning" align="center">{t('catalog.BarcodeScanSheet.camera_permission_is_turned_off_enable_it', { brand: brand.name })}</Text>
        )}
      </View>
    );
  } else if (cameraError) {
    body = <Notice text={cameraError} />;
  } else {
    body = (
      <View style={[styles.frame, { backgroundColor: colors.mediaBg }]}>
        {visible ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'code93', 'itf14', 'codabar', 'qr'] }}
            onBarcodeScanned={onBarcode}
            onMountError={(e) => setCameraError(e.message || 'Could not start the camera.')}
          />
        ) : null}
        <View pointerEvents="none" style={styles.reticleWrap}>
          <View style={[styles.reticle, { borderColor: colors.accent }]} />
          <Text variant="smallStrong" color={colors.onMedia} style={styles.reticleText}>{t('catalog.BarcodeScanSheet.point_at_the_barcode')}</Text>
        </View>
      </View>
    );
  }

  return (
    <Sheet visible={visible} onClose={onClose} title={t('catalog.BarcodeScanSheet.scan_barcode')} subtitle={t('catalog.BarcodeScanSheet.hold_the_code_steady_inside_the_frame')} width={520}>
      {body}
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
        <Input
          containerStyle={{ flex: 1 }}
          label={t('catalog.BarcodeScanSheet.or_type_scan_the_code')}
          placeholder={t('catalog.BarcodeScanSheet.e_g_8901234567890')}
          value={manual}
          onChangeText={setManual}
          onSubmitEditing={submitManual}
          error={manualError}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={48}
          icon="barcode-outline"
        />
        <Button title={t('catalog.BarcodeScanSheet.use')} onPress={submitManual} disabled={!manual.trim() || !!manualError} style={{ marginTop: 24 }} />
      </View>
    </Sheet>
  );
}

function Notice({ text }: { text: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.frame, { backgroundColor: colors.surfaceSunken, padding: 20 }]}>
      <Text tone="muted" align="center">{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { height: 280, borderRadius: 14, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  reticleWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: 12 },
  reticle: { width: '72%', height: 120, borderWidth: 3, borderRadius: 12 },
  reticleText: { textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 4 },
});
