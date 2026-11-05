import type { ConnectedDevice, DevicePlatform, PairCode, WaitMinutes } from "@/lib/types/devices";

// The ansa phone app on Settings → Your phone (the owner's design of
// 2026-11-04): the words and the drawing the page needs, pure, so the
// browser runs them and a check can read every case.

// The minutes an owner may choose: no connected phone checked in for that
// long = ansa switches to away by itself. Core refuses any other value.
export const WAIT_MINUTES: readonly WaitMinutes[] = [1, 5, 15, 30];

// How long a code to connect a phone works (core's rule: one use, 5 minutes).
export const PAIR_CODE_MINUTES = 5;

// The blank border every QR code needs around it, in modules: a camera finds
// the code's corners only against a light edge of 4 modules (the QR
// standard's quiet zone).
export const QR_QUIET_ZONE = 4;

export const PLATFORM_LABELS: Record<DevicePlatform, string> = {
  ios: "iPhone",
  android: "Android",
};

// "1 minute", "5 minutes".
export function waitInWords(minutes: number): string {
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

// The code as people type it: "K7P2-QM9X" (the app takes it with or without the dash).
export function pairCodeForTyping(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

// Only a pairing link is offered as a link: whatever else came back is
// never put in an href (a "javascript:" address would run in the page).
export function isPairingLink(link: string): boolean {
  return link.startsWith("ansa://pair?");
}

// A QR code the page can draw: as many rows as its size says, each that long,
// of 0s and 1s only. Anything else is left undrawn (the typed code still works).
export function isDrawableQr(qr: PairCode["qr"]): boolean {
  return qr.size > 0 && qr.rows.length === qr.size && qr.rows.every((row) => row.length === qr.size && /^[01]+$/.test(row));
}

// The dark modules as one SVG path, moved in by the quiet zone: each run of
// dark modules in a row is one rectangle ("M5 4h3v1h-3z"), so the path stays
// short and the squares meet without hairline gaps.
export function qrSquaresPath(rows: string[]): string {
  const parts: string[] = [];
  rows.forEach((row, rowIndex) => {
    let column = 0;
    while (column < row.length) {
      if (row[column] !== "1") {
        column += 1;
        continue;
      }
      const runStart = column;
      while (column < row.length && row[column] === "1") {
        column += 1;
      }
      const runLength = column - runStart;
      parts.push(`M${runStart + QR_QUIET_ZONE} ${rowIndex + QR_QUIET_ZONE}h${runLength}v1h-${runLength}z`);
    }
  });
  return parts.join("");
}

// The phone this code connected, once one did: a phone connected after the
// code was made (both times are core's clock). null while none has.
export function pairedWithCode(devices: ConnectedDevice[], pairCode: PairCode): ConnectedDevice | null {
  const madeAt = Date.parse(pairCode.expiresAt) - PAIR_CODE_MINUTES * 60_000;
  return devices.find((device) => Date.parse(device.pairedAt) >= madeAt) ?? null;
}

// "4:05": the minutes and seconds a code still works.
export function countdownText(secondsLeft: number): string {
  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
