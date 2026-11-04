// Reading what the camera or a link gives the app: the pairing link inside
// ansa's QR code (ansa://pair?u=<server>&c=<code>), or a bare code typed or
// scanned on its own. Pure, so every case is easy to check.

// The letters and digits ansa's codes use: no 0/O, 1/I or L, which people mix up.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 8;

export type PairingRequest = {
  // The 8-character code, upper case, without the dash.
  code: string;
  // The device API's address from the link, or null when only a code was given.
  serverUrl: string | null;
};

// A code as people write it: any case, with or without the dash or spaces.
// Returns the clean code, or null when it can't be one of ansa's codes.
export function readCode(text: string): string | null {
  const compact = text.replace(/[\s-]/g, "").toUpperCase();
  if (compact.length !== CODE_LENGTH) return null;
  for (const letter of compact) {
    if (!CODE_ALPHABET.includes(letter)) return null;
  }
  return compact;
}

// What the code box shows while someone types: upper case, letters and
// digits only, at most 8, with the dash after the fourth ("K7P2-QM9X").
export function formatCodeForTyping(text: string): string {
  const letters = text.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, CODE_LENGTH);
  return letters.length > 4 ? `${letters.slice(0, 4)}-${letters.slice(4)}` : letters;
}

// A pairing link, a link of Expo Go's form during development
// (exp://<host>/--/pair?...), or a bare code. Null when it is none of them.
export function readPairingText(text: string): PairingRequest | null {
  const trimmed = text.trim();
  const bareCode = readCode(trimmed);
  if (bareCode) return { code: bareCode, serverUrl: null };
  return readPairingLink(trimmed);
}

function readPairingLink(link: string): PairingRequest | null {
  const questionMark = link.indexOf("?");
  if (questionMark === -1) return null;
  const beforeQuery = link.slice(0, questionMark);
  // WHY only these: a link of any other app or page is not ansa's pairing link.
  const isAnsaLink = /^ansa:\/\/\/?pair\/?$/i.test(beforeQuery) || /^exps?:\/\/.+\/--\/pair\/?$/i.test(beforeQuery);
  if (!isAnsaLink) return null;

  const params = readQuery(link.slice(questionMark + 1));
  const code = readCode(params.get("c") ?? "");
  if (!code) return null;
  const serverUrl = readServerUrl(params.get("u") ?? "");
  return { code, serverUrl };
}

// The query string's values, decoded. Written by hand because React Native's
// URLSearchParams has been incomplete on some versions.
function readQuery(query: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const pair of query.split("#")[0].split("&")) {
    const equals = pair.indexOf("=");
    if (equals === -1) continue;
    const key = pair.slice(0, equals);
    try {
      values.set(key, decodeURIComponent(pair.slice(equals + 1).replace(/\+/g, " ")));
    } catch {
      // A badly encoded value is treated as missing.
    }
  }
  return values;
}

// A server address the app may talk to: http or https only, without a
// trailing slash. Null otherwise.
export function readServerUrl(text: string): string | null {
  const trimmed = text.trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^\s/?#]+(\/[^\s?#]*)?$/i.test(trimmed)) return null;
  return trimmed;
}
