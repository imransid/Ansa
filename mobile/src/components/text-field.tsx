import { StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";
import { usePalette } from "../theme/colors";
import { type } from "../theme/type";

type TextFieldProps = Omit<TextInputProps, "style"> & {
  label: string;
  // A line under the box: what to type, or what's wrong (then said as an error).
  hint?: string;
  error?: string | null;
  // The code box: big letters, centred.
  large?: boolean;
};

// A labelled text box on the sheet. Its label is what a screen reader names it.
export function TextField({ label, hint, error, large = false, ...inputProps }: TextFieldProps) {
  const palette = usePalette();
  const note = error ?? hint;
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: palette.text }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={note ?? undefined}
        placeholderTextColor={palette.textSubtle}
        selectionColor={palette.link}
        style={[
          large ? styles.inputLarge : styles.input,
          { color: palette.text, borderColor: error ? palette.destructive : palette.input, backgroundColor: palette.sheet },
        ]}
        {...inputProps}
      />
      {note ? (
        <Text style={[styles.note, { color: error ? palette.destructive : palette.textMuted }]} accessibilityLiveRegion={error ? "polite" : "none"}>
          {note}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 6 },
  label: { ...type.smallStrong },
  input: { ...type.body, minHeight: 50, borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
  inputLarge: { ...type.code, minHeight: 64, borderWidth: 1.5, borderRadius: 14, paddingHorizontal: 14, textAlign: "center" },
  note: { ...type.small },
});
