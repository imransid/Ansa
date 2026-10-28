import "server-only";
import { createHash, randomBytes } from "node:crypto";

// The two secrets of one connection attempt (step 40):
// - the state: proves that the platform's redirect back to us answers a
//   connection THIS person started from our Accounts page (it stops a
//   stranger's link from connecting their account to our company). Only its
//   SHA-256 hash is stored (oauth_states.state_hash); the state itself goes
//   only into the redirect to the platform, which hands it back.
// - the PKCE verifier (X and YouTube): proves to the platform that the code
//   is exchanged by whoever asked for it. Stored encrypted, sent to the
//   platform only with the code; the authorize URL carries its SHA-256 hash
//   (the "challenge", method S256).

// How long a connection attempt stays open. The platforms' own codes live
// shorter (X 30 seconds, LinkedIn 30 minutes), and a consent screen takes
// seconds to minutes.
export const OAUTH_STATE_LIFETIME_MINUTES = 10;

// 32 random bytes, base64url: 43 characters, fine for every platform (X
// allows up to 500) and for PKCE (43 to 128).
export function newOauthState(): string {
  return randomBytes(32).toString("base64url");
}

export function newPkceVerifier(): string {
  return randomBytes(32).toString("base64url");
}

// What is stored and looked up: the state's SHA-256 hash, as hex. WHY no
// secret key, unlike rate limit keys: the state is 256 random bits, so its
// hash can't be turned back into it.
export function hashOauthState(state: string): string {
  return createHash("sha256").update(state, "utf8").digest("hex");
}

// The PKCE challenge for a verifier: base64url of its SHA-256 (RFC 7636, S256).
export function pkceChallengeOf(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}
