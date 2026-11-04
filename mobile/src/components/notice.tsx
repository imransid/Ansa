import { StyleSheet, Text, View } from "react-native";
import { usePalette } from "../theme/colors";
import { type } from "../theme/type";

type NoticeProps = {
  text: string;
  // "info": something to know; "problem": something that didn't work.
  tone?: "info" | "problem";
};

// A short message in a soft box on the sheet, read out when it appears.
export function Notice({ text, tone = "info" }: NoticeProps) {
  const palette = usePalette();
  const problem = tone === "problem";
  return (
    <View
      style={[styles.box, { backgroundColor: problem ? palette.attentionSurface : palette.secondary }]}
      accessibilityRole={problem ? "alert" : "text"}
      accessibilityLiveRegion="polite"
    >
      <Text style={[styles.text, { color: problem ? palette.attention : palette.text }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
  text: { ...type.small, fontSize: 15, lineHeight: 21 },
});
