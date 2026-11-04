import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BrandMark } from "../components/brand-mark";
import { StatusBarBackdrop } from "../components/status-bar-backdrop";
import { usePalette } from "../theme/colors";
import { type } from "../theme/type";
import { ActivityList } from "./activity-list";
import { CheckInLine } from "./check-in-line";
import { NeedsYou } from "./needs-you";
import { StatusCard } from "./status-card";
import type { AccountSync } from "./use-account-sync";

type HomeScreenProps = {
  sync: AccountSync;
  onOpenSettings: () => void;
};

// Home: the account, what ansa does right now with the one button that
// changes it, whether this phone checked in, what needs the owner, and what
// ansa did. Pull down to check in again.
export function HomeScreen({ sync, onOpenSettings }: HomeScreenProps) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.screen, { backgroundColor: palette.frame }]}>
      <StatusBar style="light" />
      {/* WHY: below the sheet, a pull past the end shows the sheet's colour, not the frame's. */}
      <View style={[styles.sheetBehind, { backgroundColor: palette.sheet }]} />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={sync.refreshing} onRefresh={sync.refresh} tintColor={palette.onFrame} colors={[palette.primary]} />}
      >
        <View style={[styles.frame, { paddingTop: insets.top + 12, backgroundColor: palette.frame }]}>
          <View style={styles.topBar}>
            <BrandMark />
            <Pressable
              onPress={onOpenSettings}
              accessibilityRole="button"
              hitSlop={8}
              style={({ pressed }) => [styles.settings, { backgroundColor: pressed ? "rgba(246, 241, 228, 0.16)" : "rgba(246, 241, 228, 0.08)" }]}
            >
              <Text style={[type.smallStrong, { color: palette.onFrame }]}>Settings</Text>
            </Pressable>
          </View>
          <Text style={[styles.account, { color: palette.onFrame }]} numberOfLines={2} accessibilityRole="header">
            {sync.status?.accountName ?? " "}
          </Text>
          {sync.status ? <StatusCard status={sync.status} changeAway={sync.changeAway} /> : <StatusLoading problem={sync.problem !== null} />}
          <CheckInLine lastCheckIn={sync.lastCheckIn} problem={sync.problem} />
        </View>
        <View style={[styles.sheet, { backgroundColor: palette.sheet, paddingBottom: insets.bottom + 32 }]}>
          <NeedsYou count={sync.needsYou} />
          <ActivityList lines={sync.activity} />
        </View>
      </ScrollView>
      <StatusBarBackdrop />
    </View>
  );
}

// Before the first answer: a quiet placeholder the size of the card.
function StatusLoading({ problem }: { problem: boolean }) {
  const palette = usePalette();
  return (
    <View style={[styles.loading, { backgroundColor: palette.statusCard }]}>
      {problem ? <Text style={[type.body, { color: palette.onFrameMuted }]}>ansa's answer will show here.</Text> : <ActivityIndicator color={palette.brass} />}
    </View>
  );
}

const SHEET_RADIUS = 28;
const styles = StyleSheet.create({
  screen: { flex: 1 },
  sheetBehind: { position: "absolute", left: 0, right: 0, bottom: 0, height: "50%" },
  scroll: { flexGrow: 1 },
  // The frame reaches under the sheet's rounded corners (marginTop below), so they show green.
  frame: { paddingHorizontal: 20, paddingBottom: 24 + SHEET_RADIUS, gap: 16 },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  settings: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  account: { ...type.heading, fontSize: 19, lineHeight: 25, marginTop: 10 },
  loading: { height: 260, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  sheet: { flexGrow: 1, marginTop: -SHEET_RADIUS, borderTopLeftRadius: SHEET_RADIUS, borderTopRightRadius: SHEET_RADIUS, paddingHorizontal: 20, paddingTop: 24, gap: 28 },
});
