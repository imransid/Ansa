import { Pressable, StyleSheet, Text, View } from "react-native";
import { usePalette } from "../theme/colors";
import { type } from "../theme/type";

type InlineChangeProps = {
  label: string;
  value: string;
  onChange: () => void;
};

// A setting that is usually right as it is: its value in one line, and a
// small "Change" that opens its box.
export function InlineChange({ label, value, onChange }: InlineChangeProps) {
  const palette = usePalette();
  return (
    <View style={[styles.row, { borderColor: palette.border }]}>
      <Text style={[styles.text, { color: palette.textMuted }]} numberOfLines={1}>
        {label}: <Text style={{ color: palette.text }}>{value}</Text>
      </Text>
      <Pressable onPress={onChange} accessibilityRole="button" accessibilityLabel={`Change ${label.toLowerCase()}`} hitSlop={12}>
        <Text style={[styles.change, { color: palette.link }]}>Change</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 12,
  },
  text: { ...type.small, flexShrink: 1 },
  change: { ...type.smallStrong },
});
