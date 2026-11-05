import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePalette } from "../theme/colors";

// A strip of the green frame behind the phone's status bar (the clock and
// battery), so they stay readable when the white sheet scrolls up under them.
export function StatusBarBackdrop() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  return <View pointerEvents="none" style={[styles.strip, { height: insets.top, backgroundColor: palette.frame }]} />;
}

const styles = StyleSheet.create({
  strip: { position: "absolute", top: 0, left: 0, right: 0 },
});
