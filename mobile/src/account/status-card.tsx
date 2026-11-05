import * as Haptics from "expo-haptics";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { DeviceApiError } from "../api/device-api";
import type { Status } from "../api/types";
import { Button } from "../components/button";
import { describeStatus } from "../status/describe-status";
import { usePalette, type Palette } from "../theme/colors";
import { type } from "../theme/type";

type StatusCardProps = {
  status: Status;
  changeAway: (away: boolean) => Promise<void>;
};

// Home's signature, as on the website: a deep green card with a fine brass
// rule inside its edge, set like a printed menu. What ansa does right now,
// big and clear, and the one button that changes it: I'm away / I'm back.
export function StatusCard({ status, changeAway }: StatusCardProps) {
  const palette = usePalette();
  const words = describeStatus(status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const press = async (away: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await changeAway(away);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    } catch (failure) {
      setError(failure instanceof DeviceApiError ? failure.message : "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.card, { backgroundColor: palette.statusCard, borderTopColor: palette.statusCardHighlight }]}>
      <View pointerEvents="none" style={[styles.rule, { borderColor: palette.brassRule }]} />
      <View style={styles.words} accessible accessibilityLabel={`Right now: ${words.word}. ${words.sentence} ${words.details.join(" ")}`}>
        <View style={styles.labelRow}>
          <View style={[styles.dot, { backgroundColor: dotColor(words.word, palette) }]} />
          <Text style={[styles.label, { color: palette.brass }]}>Right now</Text>
        </View>
        <Text style={[styles.word, { color: palette.ivory }]}>{words.word}</Text>
        <Text style={[styles.sentence, { color: palette.ivory }]}>{words.sentence}</Text>
        {words.details.map((detail) => (
          <Text key={detail} style={[styles.detail, { color: palette.onFrameMuted }]}>
            {detail}
          </Text>
        ))}
      </View>
      {words.button ? (
        <View style={styles.action}>
          <Button
            label={words.button.label}
            accessibleLabel={words.button.accessibleLabel}
            look="on-green"
            busy={busy}
            onPress={() => void press(words.button!.away)}
          />
          {error ? (
            <Text style={[styles.error, { color: palette.ivory }]} accessibilityRole="alert">
              {error}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

// A small light beside "Right now": green while the owner answers, brass
// while ansa answers for them, grey while ansa is paused.
function dotColor(word: ReturnType<typeof describeStatus>["word"], palette: Palette): string {
  if (word === "Available") return palette.onFrameLive;
  if (word === "Away") return palette.brass;
  return palette.onFrameMuted;
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 22,
    borderTopWidth: StyleSheet.hairlineWidth,
    padding: 24,
    gap: 22,
    overflow: "hidden",
    shadowColor: "#000A05",
    shadowOpacity: 0.25,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  },
  // The fine brass line 7 points inside the card's edge.
  rule: { position: "absolute", top: 7, left: 7, right: 7, bottom: 7, borderWidth: 1, borderRadius: 15 },
  words: { gap: 6 },
  labelRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  label: { ...type.smallStrong, letterSpacing: 0.4 },
  word: { ...type.displayLarge, marginTop: 2 },
  sentence: { ...type.displaySmall, marginBottom: 6 },
  detail: { ...type.body, fontSize: 15, lineHeight: 22 },
  action: { gap: 10 },
  error: { ...type.small, textAlign: "center" },
});
