import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "@/lib/env";

// AES-256-GCM encryption for sensitive text stored in the database: call
// transcripts, what Claude wrote about each call and the customer's sentence
// behind a "solved", received emails' subjects, bodies and attachment names,
// ticket notes, the Co-Founder's interview messages, and the OAuth tokens and
// PKCE verifiers of social accounts (step 40); the contexts are in
// lib/encryption-contexts.ts. Better Auth encrypts its own login tokens
// itself (encryptOAuthTokens in lib/auth.ts).
//
// Stored format: "v1:<iv>:<authTag>:<ciphertext>", each part base64.
// "v1" lets us switch keys or algorithms later without guessing old rows.
//
// `context` is mixed in as "additional authenticated data": it is not secret
// and not stored, but decrypting with a different context fails. We pass the
// owning company and record, so a ciphertext copied into another company's
// row cannot be decrypted there.

const FORMAT_VERSION = "v1";
// encryptText always writes a full 16-byte tag. Node would also accept a
// shorter one (down to 4 bytes) when decrypting, and every byte cut off makes
// a forged value easier to guess, so decryptText refuses any other length.
const AUTH_TAG_BYTES = 16;
const key = Buffer.from(env.DATA_ENCRYPTION_KEY, "base64");

// Encrypts text so only this app (with DATA_ENCRYPTION_KEY) can read it.
export function encryptText(plainText: string, context: string): string {
  // A fresh random 12-byte IV for every encryption. Never reuse one with the same key.
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: AUTH_TAG_BYTES });
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [
    FORMAT_VERSION,
    iv.toString("base64"),
    authTag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

// Decrypts text made by encryptText with the same context. Throws if the data
// was changed, the context differs, the key is wrong, or the tag isn't the
// full 16 bytes encryptText writes.
export function decryptText(encrypted: string, context: string): string {
  const [version, iv, authTag, ciphertext] = encrypted.split(":");
  if (version !== FORMAT_VERSION || !iv || !authTag || !ciphertext) {
    throw new Error("Unknown encrypted text format");
  }
  const tag = Buffer.from(authTag, "base64");
  if (tag.length !== AUTH_TAG_BYTES) {
    throw new Error("Unknown encrypted text format");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"), { authTagLength: AUTH_TAG_BYTES });
  decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(tag);
  const plainText = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")),
    decipher.final(),
  ]);
  return plainText.toString("utf8");
}

// Stored text decrypted for a page. unreadable: it is stored but can't be
// decrypted (a wrong DATA_ENCRYPTION_KEY, damaged data); text is null then.
export type DisplayText = { text: string | null; unreadable: boolean };

// Decrypts stored text to show it on a page (or to hand a transcript to the
// call brain). Nothing stored gives text null. Text that can't be decrypted is
// flagged, so the page says so instead of showing it as missing or empty, and
// the call brain escalates instead of treating it as no transcript.
export function decryptForDisplay(encrypted: string | null, context: string): DisplayText {
  if (!encrypted) {
    return { text: null, unreadable: false };
  }
  try {
    return { text: decryptText(encrypted, context), unreadable: false };
  } catch {
    // Never log the ciphertext, the context or anything from the text. The
    // setting is named here, in the operator's log, and not on the page:
    // customers' teams can't do anything about it.
    console.error("Could not decrypt stored text: check DATA_ENCRYPTION_KEY");
    return { text: null, unreadable: true };
  }
}
