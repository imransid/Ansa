import { StyleSheet, Text, View } from "react-native";
import { usePalette } from "../theme/colors";
import { type } from "../theme/type";
import { BellMark } from "./bell-mark";

// ansa's name with its bell, as on the website's sidebar: a brass bell and
// an ivory name on the green frame. Screen readers read "ansa".
export function BrandMark({ large = false }: { large?: boolean }) {
  const palette = usePalette();
  const bellSize = large ? 30 : 22;
  return (
    <View style={styles.row} accessible accessibilityRole="header" accessibilityLabel="ansa">
      <BellMark size={bellSize} color={palette.brass} />
      <Text style={[large ? styles.nameLarge : styles.name, { color: palette.onFrame }]}>ansa</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  name: { ...type.displaySmall, fontSize: 26, lineHeight: 30 },
  nameLarge: { ...type.display, fontSize: 34, lineHeight: 40 },
});
