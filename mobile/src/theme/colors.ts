// ansa's colours, by job, the same as the website's ("Dining room", step 44:
// app/globals.css): a forest-green frame holding a white sheet, bottle green
// for actions, champagne brass only as a detail on green (never text on
// white: 1.8:1), ivory for text on green. Dark mode is designed, not
// inverted: deep forest surfaces, ivory text, never black.
import { useColorScheme } from "react-native";

export type Palette = {
  // The forest-green frame around everything, and what sits on it.
  frame: string;
  onFrame: string;
  onFrameMuted: string;
  // A soft green dot on the frame: "checked in"; a warm one: "can't reach ansa".
  onFrameLive: string;
  onFrameWarning: string;
  // The status card on the frame, and its fine brass rule.
  statusCard: string;
  statusCardHighlight: string;
  brass: string;
  brassRule: string;
  ivory: string;
  // Words on an ivory button on the frame.
  onIvory: string;
  // The sheet where things are read, and what sits on it.
  sheet: string;
  page: string;
  text: string;
  textMuted: string;
  textSubtle: string;
  border: string;
  input: string;
  // Actions: bottle green with ivory words.
  primary: string;
  onPrimary: string;
  // Soft fills (sage) and green words on the sheet.
  secondary: string;
  link: string;
  focusRing: string;
  destructive: string;
  attention: string;
  attentionSurface: string;
};

const light: Palette = {
  frame: "#0B3529",
  onFrame: "#F6F1E4", // 12.0:1
  onFrameMuted: "#B7C5BC", // 7.5:1
  onFrameLive: "#8DC3A7",
  onFrameWarning: "#E0A84A",
  statusCard: "#0E4A38",
  statusCardHighlight: "#17604A",
  brass: "#D9BE8A", // 7.5:1 on forest, 5.7:1 on bottle
  brassRule: "rgba(217, 190, 138, 0.3)",
  ivory: "#F6F1E4",
  onIvory: "#0B3529",
  sheet: "#FFFFFF",
  page: "#F4F5F1",
  text: "#11211A", // 16.7:1 on the sheet
  textMuted: "#55665D", // 6.1:1
  textSubtle: "#637269", // 4.6:1: times and meta, on the sheet only
  border: "rgba(18, 40, 31, 0.11)",
  input: "rgba(18, 40, 31, 0.2)",
  primary: "#0E4A38", // ivory on it 9.1:1
  onPrimary: "#F6F1E4",
  secondary: "#E7EEE9",
  link: "#0E4A38",
  focusRing: "#0E4A38",
  destructive: "#A82A22", // 7.0:1
  attention: "#8A5A12",
  attentionSurface: "#F7EEDC",
};

const dark: Palette = {
  frame: "#0D1A14",
  onFrame: "#F6F1E4",
  onFrameMuted: "#A9B8AE",
  onFrameLive: "#8DC3A7",
  onFrameWarning: "#E0A84A",
  statusCard: "#0E3A2C",
  statusCardHighlight: "#154A3A",
  brass: "#D9BE8A",
  brassRule: "rgba(217, 190, 138, 0.3)",
  ivory: "#F6F1E4",
  onIvory: "#0D1A14",
  sheet: "#14251D",
  page: "#0D1A14",
  text: "#F6F1E4", // 14.2:1 on the sheet
  textMuted: "#A9B8AE", // 7.7:1
  textSubtle: "#8FA398", // 5.5:1
  border: "rgba(246, 241, 228, 0.09)",
  input: "rgba(246, 241, 228, 0.18)",
  primary: "#1F6B52", // ivory on it 5.7:1
  onPrimary: "#F6F1E4",
  secondary: "#1D3A2F",
  link: "#8DC3A7", // 8.0:1
  focusRing: "#D9BE8A",
  destructive: "#F08C80", // 6.7:1
  attention: "#E0A84A", // 7.5:1
  attentionSurface: "rgba(224, 168, 74, 0.12)",
};

// The palette for the phone's light or dark setting.
export function usePalette(): Palette {
  return useColorScheme() === "dark" ? dark : light;
}
