// ansa's two typefaces, as on the website (step 44): Instrument Sans for the
// interface, at two weights only (500 for everything, 600 for headings and
// emphasis), and Fraunces for the few big moments. The font files come
// inside the app (the @expo-google-fonts packages): nothing is fetched from
// the internet when the app runs. Each weight is imported on its own, so the
// app carries three font files, not the families' thirty.
import { Fraunces_400Regular } from "@expo-google-fonts/fraunces/400Regular";
import { InstrumentSans_500Medium } from "@expo-google-fonts/instrument-sans/500Medium";
import { InstrumentSans_600SemiBold } from "@expo-google-fonts/instrument-sans/600SemiBold";
import type { TextStyle } from "react-native";

// What useFonts loads (App.tsx), by the family names the styles use.
export const FONT_FILES = {
  InstrumentSans_500Medium,
  InstrumentSans_600SemiBold,
  Fraunces_400Regular,
};

const SANS = "InstrumentSans_500Medium";
const SANS_BOLD = "InstrumentSans_600SemiBold";
const DISPLAY = "Fraunces_400Regular";

// WHY no fontWeight anywhere: each weight is its own font file, and setting
// a weight on top makes the phone pick a system font instead.
export const type = {
  // The status word on Home ("Available") and the welcome's headline.
  displayLarge: { fontFamily: DISPLAY, fontSize: 46, lineHeight: 52, letterSpacing: -0.9 },
  // Big sentences and screen titles.
  display: { fontFamily: DISPLAY, fontSize: 30, lineHeight: 36, letterSpacing: -0.6 },
  displaySmall: { fontFamily: DISPLAY, fontSize: 22, lineHeight: 28, letterSpacing: -0.3 },
  // A count that matters ("Needs you").
  numeral: { fontFamily: DISPLAY, fontSize: 44, lineHeight: 48, letterSpacing: -0.9, fontVariant: ["tabular-nums", "lining-nums"] },
  heading: { fontFamily: SANS_BOLD, fontSize: 17, lineHeight: 22 },
  body: { fontFamily: SANS, fontSize: 16, lineHeight: 23 },
  bodyStrong: { fontFamily: SANS_BOLD, fontSize: 16, lineHeight: 23 },
  small: { fontFamily: SANS, fontSize: 14, lineHeight: 20 },
  smallStrong: { fontFamily: SANS_BOLD, fontSize: 14, lineHeight: 20 },
  // Times and meta, lined up in columns.
  meta: { fontFamily: SANS, fontSize: 13, lineHeight: 18, fontVariant: ["tabular-nums"] },
  button: { fontFamily: SANS_BOLD, fontSize: 17, lineHeight: 22 },
  // The 8-character code as it is typed.
  code: { fontFamily: SANS_BOLD, fontSize: 28, lineHeight: 34, letterSpacing: 4, fontVariant: ["tabular-nums"] },
} satisfies Record<string, TextStyle>;
