import "server-only";
import { createHash, randomBytes } from "node:crypto";

// Makes a new random invite token. 32 bytes = 256 bits, far too many to guess.
// The token only ever lives in the invite link; the database stores its hash.
export function generateInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

// Turns a token into the value stored in invites.token_hash.
export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
