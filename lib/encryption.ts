import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "@/lib/env";

// AES-256-GCM encryption for sensitive text stored in the database
// (call transcripts now, OAuth tokens later).
//
// Stored format: "v1:<iv>:<authTag>:<ciphertext>", each part base64.
// "v1" lets us switch keys or algorithms later without guessing old rows.
//
// `context` is mixed in as "additional authenticated data": it is not secret
// and not stored, but decrypting with a different context fails. We pass the
// owning company and record, so a ciphertext copied into another company's
// row cannot be decrypted there.

const FORMAT_VERSION = "v1";
const key = Buffer.from(env.DATA_ENCRYPTION_KEY, "base64");

// Encrypts text so only this app (with DATA_ENCRYPTION_KEY) can read it.
export function encryptText(plainText: string, context: string): string {
  // A fresh random 12-byte IV for every encryption. Never reuse one with the same key.
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
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
// was changed, the context differs, or the key is wrong.
export function decryptText(encrypted: string, context: string): string {
  const [version, iv, authTag, ciphertext] = encrypted.split(":");
  if (version !== FORMAT_VERSION || !iv || !authTag || !ciphertext) {
    throw new Error("Unknown encrypted text format");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(Buffer.from(authTag, "base64"));
  const plainText = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")),
    decipher.final(),
  ]);
  return plainText.toString("utf8");
}
