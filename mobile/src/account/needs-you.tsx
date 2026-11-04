import { StyleSheet, Text, View } from "react-native";
import { usePalette } from "../theme/colors";
import { type } from "../theme/type";

// How many things wait for a person, as one big number: what the owner
// glances at. Answering them happens in ansa on the website.
export function NeedsYou({ count }: { count: number | null }) {
  const palette = usePalette();
  const waiting = count !== null && count > 0;
  return (
    <View
      style={[styles.box, { backgroundColor: waiting ? palette.attentionSurface : palette.secondary }]}
      accessible
      accessibilityLabel={describe(count)}
    >
      <Text style={[styles.number, { color: waiting ? palette.attention : palette.link }]}>{count === null ? "–" : count}</Text>
      <View style={styles.words}>
        <Text style={[type.heading, { color: palette.text }]}>{heading(count)}</Text>
        <Text style={[type.small, { color: palette.textMuted }]}>{waiting ? "Answer them in ansa's Inbox." : "ansa tells you here when something does."}</Text>
      </View>
    </View>
  );
}

function heading(count: number | null): string {
  if (count === null) return "Needs you";
  if (count === 0) return "Nothing needs you right now";
  return count === 1 ? "thing needs you" : "things need you";
}

function describe(count: number | null): string {
  if (count === null) return "Needs you: not known yet.";
  if (count === 0) return "Nothing needs you right now.";
  return count === 1 ? "One thing needs you. Answer it in ansa's Inbox." : `${count} things need you. Answer them in ansa's Inbox.`;
}

const styles = StyleSheet.create({
  box: { flexDirection: "row", alignItems: "center", gap: 16, borderRadius: 18, paddingVertical: 16, paddingHorizontal: 20 },
  number: { ...type.numeral, minWidth: 36, textAlign: "center" },
  words: { flex: 1, gap: 2 },
});
