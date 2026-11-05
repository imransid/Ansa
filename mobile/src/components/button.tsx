import { ActivityIndicator, Pressable, StyleSheet, Text } from "react-native";
import { usePalette, type Palette } from "../theme/colors";
import { type } from "../theme/type";

// The looks a button can have:
// - primary: the one thing to do on the sheet (bottle green, ivory words);
// - on-green: the one thing to do on the green frame (ivory, forest words);
// - on-green-quiet: a second choice on the frame or over the camera;
// - quiet: a second choice, words only;
// - destructive: something that can't be taken back (red outline).
export type ButtonLook = "primary" | "on-green" | "on-green-quiet" | "quiet" | "destructive";

type ButtonProps = {
  label: string;
  onPress: () => void;
  look?: ButtonLook;
  // While the button's action runs: a spinner, and no second press.
  busy?: boolean;
  disabled?: boolean;
  // What a screen reader says, when the label alone doesn't say what happens.
  accessibleLabel?: string;
};

export function Button({ label, onPress, look = "primary", busy = false, disabled = false, accessibleLabel }: ButtonProps) {
  const palette = usePalette();
  const colors = lookColors(look, palette);
  const inactive = disabled || busy;
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={accessibleLabel ?? label}
      accessibilityState={{ disabled: inactive, busy }}
      style={({ pressed }) => [
        styles.base,
        look === "quiet" ? styles.quiet : null,
        { backgroundColor: colors.background, borderColor: colors.border },
        pressed && !inactive ? styles.pressed : null,
        disabled ? styles.disabled : null,
      ]}
    >
      {busy ? <ActivityIndicator color={colors.text} /> : <Text style={[styles.label, { color: colors.text }]}>{label}</Text>}
    </Pressable>
  );
}

function lookColors(look: ButtonLook, palette: Palette): { background: string; border: string; text: string } {
  if (look === "on-green") return { background: palette.ivory, border: palette.ivory, text: palette.onIvory };
  if (look === "on-green-quiet") return { background: "rgba(11, 53, 41, 0.72)", border: "rgba(246, 241, 228, 0.3)", text: palette.ivory };
  if (look === "quiet") return { background: "transparent", border: "transparent", text: palette.link };
  if (look === "destructive") return { background: "transparent", border: palette.destructive, text: palette.destructive };
  return { background: palette.primary, border: palette.primary, text: palette.onPrimary };
}

const styles = StyleSheet.create({
  base: {
    minHeight: 54,
    borderRadius: 14,
    borderWidth: 1.5,
    paddingHorizontal: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  quiet: { minHeight: 46 },
  pressed: { opacity: 0.82, transform: [{ scale: 0.985 }] },
  disabled: { opacity: 0.5 },
  label: { ...type.button, textAlign: "center" },
});
