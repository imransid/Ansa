import { StyleSheet, View } from "react-native";

type BellMarkProps = {
  size: number;
  color: string;
  // The line's width at a 24-point bell; it grows with the bell.
  strokeAt24?: number;
};

// ansa's mark: a concierge bell, drawn with plain views (the website draws
// the same bell, Lucide's ConciergeBell, on a 24-point grid: a button on a
// short stem, a dome, and a base). ansa greets the guests and rings for the
// owner only when it matters. Decoration only: screen readers skip it.
export function BellMark({ size, color, strokeAt24 = 1.6 }: BellMarkProps) {
  const unit = size / 24;
  const stroke = Math.max(1, strokeAt24 * unit);
  const half = stroke / 2;
  return (
    <View style={{ width: size, height: size }} accessible={false} importantForAccessibility="no-hide-descendants">
      {/* The button on top: a short bar from x 10 to 14 at y 4. */}
      <View style={[styles.part, { left: 10 * unit - half, top: 4 * unit - half, width: 4 * unit + stroke, height: stroke, borderRadius: half, backgroundColor: color }]} />
      {/* The stem: from y 4 down to the dome at y 8. */}
      <View style={[styles.part, { left: 12 * unit - half, top: 4 * unit, width: stroke, height: 4 * unit, backgroundColor: color }]} />
      {/* The dome: half a circle of radius 8 around (12, 16), open below. */}
      <View
        style={[
          styles.part,
          {
            left: 4 * unit - half,
            top: 8 * unit - half,
            width: 16 * unit + stroke,
            height: 8 * unit + half,
            borderColor: color,
            borderWidth: stroke,
            borderBottomWidth: 0,
            borderTopLeftRadius: 8 * unit + half,
            borderTopRightRadius: 8 * unit + half,
          },
        ]}
      />
      {/* The base: from x 2 to 22, y 16 to 20, rounder on top. */}
      <View
        style={[
          styles.part,
          {
            left: 2 * unit - half,
            top: 16 * unit - half,
            width: 20 * unit + stroke,
            height: 4 * unit + stroke,
            borderColor: color,
            borderWidth: stroke,
            borderTopLeftRadius: 2 * unit + half,
            borderTopRightRadius: 2 * unit + half,
            borderBottomLeftRadius: unit + half,
            borderBottomRightRadius: unit + half,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  part: { position: "absolute" },
});
