import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Status } from "../api/types";
import { readBackgroundCheckIns, type BackgroundCheckIns } from "../background/check-in-task";
import type { SavedConnection } from "../storage/saved-connection";
import { usePalette } from "../theme/colors";
import { type } from "../theme/type";
import { DisconnectButton } from "./disconnect-button";
import { SettingsSection, SettingsValue } from "./settings-parts";

type SettingsScreenProps = {
  connection: SavedConnection;
  status: Status | null;
  onBack: () => void;
  onDisconnected: () => void;
};

// A small screen: this phone, what "unreachable" means and where it is
// changed, the honest note about apps in the background, and disconnecting.
export function SettingsScreen({ connection, status, onBack, onDisconnected }: SettingsScreenProps) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const [background, setBackground] = useState<BackgroundCheckIns | null>(null);

  useEffect(() => {
    readBackgroundCheckIns().then(setBackground);
  }, []);

  return (
    <View style={[styles.screen, { backgroundColor: palette.frame }]}>
      <StatusBar style="light" />
      <View style={[styles.sheetBehind, { backgroundColor: palette.sheet }]} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={[styles.frame, { paddingTop: insets.top + 12, backgroundColor: palette.frame }]}>
          <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back to Home" hitSlop={12} style={styles.back}>
            <Text style={[type.bodyStrong, { color: palette.onFrame }]}>‹ Home</Text>
          </Pressable>
          <Text style={[styles.title, { color: palette.onFrame }]} accessibilityRole="header">
            Settings
          </Text>
        </View>
        <View style={[styles.sheet, { backgroundColor: palette.sheet, paddingBottom: insets.bottom + 32 }]}>
          <SettingsSection title="This phone">
            <SettingsValue label="Name" value={connection.phoneName} />
            <SettingsValue label="Connected to" value={status?.accountName ?? "ansa"} />
            <SettingsValue label="Server" value={connection.serverUrl.replace(/^https?:\/\//, "")} />
          </SettingsSection>
          <SettingsSection title="When this phone can't be reached">
            <Text style={[type.body, { color: palette.text }]}>{unreachableWords(status)}</Text>
            <Text style={[type.small, { color: palette.textMuted }]}>
              “Answer for me when my phone is unreachable” is changed on ansa's website, in Settings → Your phone. It never undoes an “I'm away” you pressed yourself.
            </Text>
          </SettingsSection>
          <SettingsSection title="In the background">
            <Text style={[type.body, { color: palette.text }]}>
              Phones pause apps you aren't using. While ansa is open, this phone checks in every 30 seconds. In the background it checks in only when the phone allows it: every 15 minutes at best, often much less, and on an iPhone not at all once you swipe ansa away.
            </Text>
            <Text style={[type.small, { color: palette.textMuted }]}>{backgroundWords(background)}</Text>
          </SettingsSection>
          <DisconnectButton connection={connection} onDisconnected={onDisconnected} />
        </View>
      </ScrollView>
    </View>
  );
}

function unreachableWords(status: Status | null): string {
  if (status === null) return "Checking with ansa…";
  if (!status.followPhone) return "Off: ansa doesn't answer for you because of your phone. Press “I'm away” when you can't answer.";
  const wait = status.waitMinutes === 1 ? "1 minute" : `${status.waitMinutes} minutes`;
  return `On: when none of your phones has checked in for ${wait}, ansa answers for you. When a phone checks in again, it hands back to you.`;
}

function backgroundWords(background: BackgroundCheckIns | null): string {
  if (background === "on") return "Background check-ins are on for this phone.";
  if (background === "off") return "Background check-ins start the next time ansa is open.";
  if (background === "unavailable") return "This phone doesn't run background check-ins for ansa (a simulator, or the Expo Go app): it checks in only while ansa is open.";
  return " ";
}

const SHEET_RADIUS = 28;
const styles = StyleSheet.create({
  screen: { flex: 1 },
  sheetBehind: { position: "absolute", left: 0, right: 0, bottom: 0, height: "50%" },
  scroll: { flexGrow: 1 },
  // The frame reaches under the sheet's rounded corners (marginTop below), so they show green.
  frame: { paddingHorizontal: 20, paddingBottom: 24 + SHEET_RADIUS, gap: 14 },
  back: { alignSelf: "flex-start", paddingVertical: 6 },
  title: { ...type.display, fontSize: 36, lineHeight: 42 },
  sheet: { flexGrow: 1, marginTop: -SHEET_RADIUS, borderTopLeftRadius: SHEET_RADIUS, borderTopRightRadius: SHEET_RADIUS, paddingHorizontal: 20, paddingTop: 24, gap: 30 },
});
