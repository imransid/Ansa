import { StyleSheet, Text, View } from "react-native";
import type { ActivityLine } from "../api/types";
import { BellMark } from "../components/bell-mark";
import { describeLocalTime } from "../status/local-time";
import { usePalette } from "../theme/colors";
import { type } from "../theme/type";

// "What ansa did": its newest lines, like the website's service log: who it
// was for, what ansa did, and when, in the phone's own time.
export function ActivityList({ lines }: { lines: ActivityLine[] | null }) {
  const palette = usePalette();
  return (
    <View style={styles.section}>
      <View style={styles.heading}>
        <BellMark size={18} color={palette.link} strokeAt24={2} />
        <Text style={[type.heading, { color: palette.text }]} accessibilityRole="header">
          What ansa did
        </Text>
      </View>
      {lines === null ? null : lines.length === 0 ? (
        <Text style={[styles.empty, { color: palette.textMuted, borderColor: palette.border }]}>
          Nothing yet. Every message ansa answers, and every note it takes for you, shows here.
        </Text>
      ) : (
        <View style={[styles.list, { borderColor: palette.border }]}>
          {lines.map((line, index) => (
            <ActivityRow key={`${line.at}-${index}`} line={line} first={index === 0} />
          ))}
        </View>
      )}
    </View>
  );
}

function ActivityRow({ line, first }: { line: ActivityLine; first: boolean }) {
  const palette = usePalette();
  const when = describeLocalTime(line.at);
  const title = line.who !== "" ? line.who : line.text;
  return (
    <View
      style={[styles.row, { borderTopColor: palette.border, borderTopWidth: first ? 0 : StyleSheet.hairlineWidth }]}
      accessible
      accessibilityLabel={[line.who, line.text, when].filter((part) => part !== "").join(", ")}
    >
      <View style={styles.rowTop}>
        <Text style={[styles.who, { color: palette.text }]} numberOfLines={1}>
          {title}
        </Text>
        <Text style={[type.meta, { color: palette.textSubtle }]}>{when}</Text>
      </View>
      {line.who !== "" ? <Text style={[type.small, { color: palette.textMuted }]}>{line.text}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  heading: { flexDirection: "row", alignItems: "center", gap: 8 },
  empty: { ...type.small, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 14 },
  list: { borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth },
  row: { paddingVertical: 12, gap: 2 },
  rowTop: { flexDirection: "row", alignItems: "baseline", gap: 12 },
  who: { ...type.bodyStrong, flex: 1 },
});
