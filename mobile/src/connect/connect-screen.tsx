import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Status } from "../api/types";
import { BrandMark } from "../components/brand-mark";
import { Button } from "../components/button";
import { Notice } from "../components/notice";
import type { PairingRequest } from "../pairing/pairing-link";
import { defaultPhoneName, defaultServerUrl, serverUrlForThisPhone } from "../pairing/phone-defaults";
import { readLastServerAndName, type SavedConnection } from "../storage/saved-connection";
import { usePalette } from "../theme/colors";
import { type } from "../theme/type";
import { CodeForm } from "./code-form";
import { PhoneNameRow } from "./phone-name-row";
import { ScannerModal } from "./scanner-modal";
import { usePairing } from "./use-pairing";

type ConnectScreenProps = {
  // Why the phone is here again ("This phone was disconnected"), or null.
  notice: string | null;
  // A pairing link the app was opened with, to connect at once.
  incomingRequest: PairingRequest | null;
  onIncomingHandled: () => void;
  onConnected: (connection: SavedConnection, status: Status) => void;
};

// The first screen: what the app does, then "Scan the code" or "Type the
// code instead". No login is typed: the code from ansa's website is enough.
export function ConnectScreen({ notice, incomingRequest, onIncomingHandled, onConnected }: ConnectScreenProps) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const [phoneName, setPhoneName] = useState(defaultPhoneName);
  const [serverUrl, setServerUrl] = useState(defaultServerUrl);
  const [typing, setTyping] = useState(false);
  const [scanning, setScanning] = useState(false);
  const pairing = usePairing(onConnected);
  // Set once a link or the camera chose the server: the saved one read
  // below must not replace it.
  const serverChosen = useRef(false);

  // The server and name used last, when this phone was connected before.
  useEffect(() => {
    readLastServerAndName().then((saved) => {
      if (saved.serverUrl && !serverChosen.current) setServerUrl(saved.serverUrl);
      if (saved.phoneName) setPhoneName(saved.phoneName);
    });
  }, []);

  const connectWith = (request: PairingRequest) => {
    const server = serverUrlForThisPhone(request.serverUrl ?? serverUrl);
    serverChosen.current = true;
    setServerUrl(server);
    void pairing.pair(request.code, server, phoneName);
  };

  useEffect(() => {
    if (!incomingRequest) return;
    onIncomingHandled();
    connectWith(incomingRequest);
    // WHY only the link: a new link connects; the name and server are read
    // as they are at that moment.
  }, [incomingRequest]);

  const openScanner = () => {
    pairing.clearError();
    setScanning(true);
  };

  return (
    <View style={[styles.screen, { backgroundColor: palette.frame }]}>
      <StatusBar style="light" />
      <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={[styles.hero, { paddingTop: insets.top + 28 }]}>
            <BrandMark />
            <View style={styles.heroWords}>
                <Text style={[styles.headline, { color: palette.onFrame }]} accessibilityRole="header">
                ansa answers when you can't.
              </Text>
              <Text style={[styles.lead, { color: palette.onFrameMuted }]}>
              Connect this phone to see what needs you, say “I'm away” from anywhere, and let ansa know you're reachable.
              </Text>
            </View>
          </View>
          <View style={[styles.sheet, { backgroundColor: palette.sheet, paddingBottom: insets.bottom + 28 }]}>
            {notice ? <Notice text={notice} /> : null}
            <View style={styles.intro}>
              <Text style={[type.heading, { color: palette.text }]}>Connect this phone</Text>
              <Text style={[type.body, { color: palette.textMuted }]}>On ansa's website, open Settings → Your phone. It shows a code to scan.</Text>
            </View>
            {pairing.error ? <Notice text={pairing.error} tone="problem" /> : null}
            {typing ? (
              <CodeForm
                serverUrl={serverUrl}
                onServerUrlChange={setServerUrl}
                busy={pairing.busy}
                onConnect={(code, server) => connectWith({ code, serverUrl: server })}
                onScanInstead={openScanner}
              />
            ) : (
              <View style={styles.actions}>
                <Button label="Scan the code" onPress={openScanner} busy={pairing.busy} />
                <Button label="Type the code instead" look="quiet" onPress={() => setTyping(true)} disabled={pairing.busy} />
              </View>
            )}
            <PhoneNameRow name={phoneName} onChange={setPhoneName} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
      <ScannerModal
        visible={scanning}
        onClose={() => setScanning(false)}
        onTypeInstead={() => {
          setScanning(false);
          setTyping(true);
        }}
        onCode={(request) => {
          setScanning(false);
          connectWith(request);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scroll: { flexGrow: 1 },
  // The frame takes the room the sheet doesn't need: the brand at the top,
  // the words just above the sheet.
  hero: { flexGrow: 1, justifyContent: "space-between", paddingHorizontal: 24, paddingBottom: 36, gap: 40 },
  heroWords: { gap: 16 },
  headline: { ...type.display, fontSize: 40, lineHeight: 46, letterSpacing: -0.9 },
  lead: { ...type.body, fontSize: 17, lineHeight: 25 },
  sheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 24, paddingTop: 28, gap: 20 },
  intro: { gap: 6 },
  actions: { gap: 4 },
});
