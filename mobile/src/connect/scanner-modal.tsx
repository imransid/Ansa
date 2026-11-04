import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import * as Haptics from "expo-haptics";
import { useEffect, useRef, useState } from "react";
import { Linking, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "../components/button";
import { readPairingText, type PairingRequest } from "../pairing/pairing-link";
import { usePalette } from "../theme/colors";
import { type } from "../theme/type";
import { CameraPermission } from "./camera-permission";

type ScannerModalProps = {
  visible: boolean;
  onCode: (request: PairingRequest) => void;
  onClose: () => void;
  onTypeInstead: () => void;
};

const NOT_ANSA_CODE = "That isn't an ansa code. Point at the code on ansa's website.";

// The camera, reading the QR code on ansa's website. It asks for the camera
// first, saying why, and works with either the pairing link the code holds
// or a bare 8-character code.
export function ScannerModal({ visible, onCode, onClose, onTypeInstead }: ScannerModalProps) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [hint, setHint] = useState<string | null>(null);
  // WHY a ref: the camera reports the same code many times a second, and
  // only the first may count.
  const handled = useRef(false);

  useEffect(() => {
    if (visible) {
      handled.current = false;
      setHint(null);
    }
  }, [visible]);

  const onScanned = (result: BarcodeScanningResult) => {
    if (handled.current) return;
    const request = readPairingText(result.data);
    if (!request) {
      setHint(NOT_ANSA_CODE);
      return;
    }
    handled.current = true;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    onCode(request);
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.screen, { backgroundColor: palette.frame }]}>
        {permission?.granted ? (
          <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={onScanned} />
        ) : null}
        <View style={[styles.overlay, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 20 }]}>
          <View style={styles.topBar}>
            <Text style={[styles.title, { color: palette.onFrame }]} accessibilityRole="header">
              Scan the code
            </Text>
            <Pressable onPress={onClose} accessibilityRole="button" hitSlop={12}>
              <Text style={[styles.cancel, { color: palette.onFrame }]}>Cancel</Text>
            </Pressable>
          </View>
          {permission?.granted ? (
            <Viewfinder brass={palette.brass} />
          ) : (
            <CameraPermission permission={permission} onAllow={requestPermission} onOpenSettings={() => Linking.openSettings()} />
          )}
          <View style={styles.bottom}>
            <Text style={[styles.hint, { color: palette.onFrame }]} accessibilityLiveRegion="polite">
              {hint ?? (permission?.granted ? "Point your camera at the code on ansa's website." : " ")}
            </Text>
            <Button label="Type the code instead" look="on-green-quiet" onPress={onTypeInstead} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

// The square the code goes in, marked by four brass corners.
function Viewfinder({ brass }: { brass: string }) {
  const corner = { borderColor: brass };
  return (
    <View style={styles.viewfinder} accessible={false}>
      <View style={[styles.corner, styles.topLeft, corner]} />
      <View style={[styles.corner, styles.topRight, corner]} />
      <View style={[styles.corner, styles.bottomLeft, corner]} />
      <View style={[styles.corner, styles.bottomRight, corner]} />
    </View>
  );
}

const CORNER = 34;
const styles = StyleSheet.create({
  screen: { flex: 1 },
  overlay: { flex: 1, justifyContent: "space-between", paddingHorizontal: 20 },
  topBar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { ...type.displaySmall },
  cancel: { ...type.bodyStrong },
  viewfinder: { alignSelf: "center", width: 250, height: 250 },
  corner: { position: "absolute", width: CORNER, height: CORNER },
  topLeft: { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 18 },
  topRight: { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 18 },
  bottomLeft: { bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 18 },
  bottomRight: { bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 18 },
  bottom: { gap: 16 },
  hint: { ...type.body, textAlign: "center", textShadowColor: "rgba(0, 0, 0, 0.5)", textShadowRadius: 6 },
});
