import { StyleSheet, Text, View } from "react-native";
import type { AccountSync } from "./use-account-sync";
import { describeAgo } from "../status/local-time";
import { usePalette } from "../theme/colors";
import { type } from "../theme/type";

type CheckInLineProps = Pick<AccountSync, "lastCheckIn" | "problem">;

// The quiet line on the frame under the status: did ansa hear this phone?
export function CheckInLine({ lastCheckIn, problem }: CheckInLineProps) {
  const palette = usePalette();
  const words = describeCheckIn(lastCheckIn, problem);
  return (
    <View style={styles.row} accessible accessibilityLabel={words} accessibilityLiveRegion="polite">
      <View style={[styles.dot, { backgroundColor: problem ? palette.onFrameWarning : palette.onFrameLive }]} />
      <Text style={[type.small, { color: palette.onFrameMuted }]}>{words}</Text>
    </View>
  );
}

function describeCheckIn(lastCheckIn: Date | null, problem: CheckInLineProps["problem"]): string {
  if (problem === "offline") return "Can't reach ansa: check your internet";
  if (problem !== null) return "ansa didn't answer just now: trying again soon";
  if (lastCheckIn === null) return "Checking in…";
  return `Checked in ${describeAgo(lastCheckIn)}`;
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8, justifyContent: "center" },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
