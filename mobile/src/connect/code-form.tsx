import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "../components/button";
import { InlineChange } from "../components/inline-change";
import { TextField } from "../components/text-field";
import { formatCodeForTyping, readCode, readServerUrl } from "../pairing/pairing-link";
import { usePalette } from "../theme/colors";
import { type } from "../theme/type";

type CodeFormProps = {
  serverUrl: string;
  onServerUrlChange: (serverUrl: string) => void;
  busy: boolean;
  onConnect: (code: string, serverUrl: string) => void;
  onScanInstead: () => void;
};

// "Type the code instead": the 8 characters ansa's website shows (any case,
// with or without the dash), and the server, filled in already and only
// changed for a phone on the Wi-Fi.
export function CodeForm({ serverUrl, onServerUrlChange, busy, onConnect, onScanInstead }: CodeFormProps) {
  const palette = usePalette();
  const [codeText, setCodeText] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [editingServer, setEditingServer] = useState(false);

  const submit = () => {
    const code = readCode(codeText);
    const server = readServerUrl(serverUrl);
    setCodeError(code ? null : "A code has 8 letters and numbers, like K7P2-QM9X. Check it on ansa's website.");
    setServerError(server ? null : "Type the address with http:// or https://, like http://192.168.1.20:8080.");
    if (!server) setEditingServer(true);
    if (code && server) onConnect(code, server);
  };

  return (
    <View style={styles.form}>
      <TextField
        label="The code"
        large
        value={codeText}
        onChangeText={(text) => setCodeText(formatCodeForTyping(text))}
        placeholder="XXXX-XXXX"
        autoCapitalize="characters"
        autoCorrect={false}
        autoComplete="off"
        spellCheck={false}
        maxLength={9}
        returnKeyType="go"
        onSubmitEditing={submit}
        hint="8 letters and numbers, as ansa's website shows them."
        error={codeError}
      />
      {editingServer ? (
        <TextField
          label="Server"
          value={serverUrl}
          onChangeText={onServerUrlChange}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          hint="Only for a phone on your Wi-Fi: the address of the computer running ansa."
          error={serverError}
        />
      ) : (
        <InlineChange label="Server" value={serverUrl.replace(/^https?:\/\//, "")} onChange={() => setEditingServer(true)} />
      )}
      <View style={styles.actions}>
        <Button label="Connect" onPress={submit} busy={busy} />
        <Button label="Scan the code instead" look="quiet" onPress={onScanInstead} disabled={busy} />
      </View>
      <Text style={[styles.note, { color: palette.textMuted }]}>The code works once, for 5 minutes.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: 16 },
  actions: { gap: 4 },
  note: { ...type.small, textAlign: "center" },
});
