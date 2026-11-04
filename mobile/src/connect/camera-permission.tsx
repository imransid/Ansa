import type { PermissionResponse } from "expo-camera";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { BellMark } from "../components/bell-mark";
import { Button } from "../components/button";
import { usePalette } from "../theme/colors";
import { type } from "../theme/type";

type CameraPermissionProps = {
  // null while the phone is still saying.
  permission: PermissionResponse | null;
  onAllow: () => void;
  onOpenSettings: () => void;
};

// Asking for the camera politely: why ansa wants it first, then the
// phone's own question. When the phone won't ask again, where to turn it on.
export function CameraPermission({ permission, onAllow, onOpenSettings }: CameraPermissionProps) {
  const palette = usePalette();
  if (permission === null) return <ActivityIndicator color={palette.onFrame} />;
  const canAsk = permission.canAskAgain;
  return (
    <View style={styles.box}>
      <View style={styles.bell}>
        <BellMark size={44} color={palette.brass} strokeAt24={1.4} />
      </View>
      <Text style={[styles.title, { color: palette.onFrame }]}>{canAsk ? "ansa needs the camera to read the code" : "The camera is off for ansa"}</Text>
      <Text style={[styles.text, { color: palette.onFrameMuted }]}>
        {canAsk
          ? "Only to read the code on ansa's website. Nothing is recorded or kept."
          : "Turn it on in your phone's Settings, or type the code instead."}
      </Text>
      <Button label={canAsk ? "Allow the camera" : "Open Settings"} look="on-green" onPress={canAsk ? onAllow : onOpenSettings} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 14, paddingHorizontal: 8 },
  bell: { alignSelf: "center" },
  title: { ...type.display, textAlign: "center" },
  text: { ...type.body, textAlign: "center", marginBottom: 8 },
});
