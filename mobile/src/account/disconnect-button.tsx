import { useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { DeviceApiError, unpairPhone } from "../api/device-api";
import { Button } from "../components/button";
import type { SavedConnection } from "../storage/saved-connection";
import { usePalette } from "../theme/colors";
import { type } from "../theme/type";

type DisconnectButtonProps = {
  connection: SavedConnection;
  // The phone forgot its connection: back to the connect screen.
  onDisconnected: () => void;
};

// "Disconnect this phone": asks first, tells ansa, then forgets the token.
// When ansa can't be reached, it says so and offers to forget it anyway.
export function DisconnectButton({ connection, onDisconnected }: DisconnectButtonProps) {
  const palette = usePalette();
  const [busy, setBusy] = useState(false);

  const disconnect = async () => {
    setBusy(true);
    try {
      await unpairPhone(connection.serverUrl, connection.token);
      onDisconnected();
    } catch (failure) {
      // Already removed on the website: nothing left to tell ansa.
      if (failure instanceof DeviceApiError && failure.kind === "unauthorized") {
        onDisconnected();
        return;
      }
      setBusy(false);
      askToForgetAnyway(onDisconnected);
    }
  };

  const ask = () => {
    Alert.alert("Disconnect this phone?", "ansa stops counting on this phone, and this app stops showing your account. You can connect it again with a new code.", [
      { text: "Cancel", style: "cancel" },
      { text: "Disconnect", style: "destructive", onPress: () => void disconnect() },
    ]);
  };

  return (
    <View style={styles.box}>
      <Button label="Disconnect this phone" look="destructive" busy={busy} onPress={ask} />
      <Text style={[type.small, styles.note, { color: palette.textMuted }]}>You can also remove it on ansa's website, in Settings → Your phone.</Text>
    </View>
  );
}

function askToForgetAnyway(onDisconnected: () => void): void {
  Alert.alert(
    "Can't reach ansa",
    "ansa didn't hear that this phone is leaving. Forget it on this phone anyway? Then remove it on ansa's website, in Settings → Your phone, or ansa may think you're away when it stops checking in.",
    [
      { text: "Keep it", style: "cancel" },
      { text: "Forget it", style: "destructive", onPress: onDisconnected },
    ],
  );
}

const styles = StyleSheet.create({
  box: { gap: 10, marginTop: 4 },
  note: { textAlign: "center" },
});
