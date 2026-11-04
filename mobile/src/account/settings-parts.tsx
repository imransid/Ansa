import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { usePalette } from "../theme/colors";
import { type } from "../theme/type";

// One part of the Settings screen: a heading and what belongs under it.
export function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  const palette = usePalette();
  return (
    <View style={styles.section}>
      <Text style={[type.heading, { color: palette.text }]} accessibilityRole="header">
        {title}
      </Text>
      {children}
    </View>
  );
}

// A label and its value on one line, divided from the next by a fine rule.
export function SettingsValue({ label, value }: { label: string; value: string }) {
  const palette = usePalette();
  return (
    <View style={[styles.value, { borderColor: palette.border }]} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={[type.body, { color: palette.textMuted }]}>{label}</Text>
      <Text style={[styles.valueText, { color: palette.text }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  value: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 10,
  },
  valueText: { ...type.bodyStrong, flexShrink: 1, textAlign: "right" },
});
