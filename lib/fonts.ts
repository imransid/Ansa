import { Fraunces, Instrument_Sans } from "next/font/google";

// The app's two typefaces (step 44). next/font downloads them when the app is
// built and serves them from ansa itself, so no page asks Google for anything.
// Shared by app/layout.tsx and app/global-error.tsx, which replaces the
// whole document and needs its own.

// The interface: every label, list and form.
export const instrumentSans = Instrument_Sans({
  variable: "--font-instrument-sans",
  subsets: ["latin"],
});

// The few big moments: Home's briefing, greetings, prices and totals. Its
// SOFT axis is kept for the softer letter ends (the font-display utility in
// app/globals.css sets it).
export const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["SOFT", "opsz"],
});

// The class names <html> carries so both are available everywhere.
export const fontVariables = `${instrumentSans.variable} ${fraunces.variable}`;
