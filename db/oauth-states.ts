import "server-only";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { canManageSocialAccounts } from "@/lib/cofounder/permissions";
import { OAUTH_STATE_LIFETIME_MINUTES } from "@/lib/oauth-state";
import type { SocialPlatform } from "@/lib/social-platforms";
import { db } from "./client";
import { lockActiveAuthorRole } from "./knowledge-author";
import { oauthStates } from "./schema";

// One company's social connection attempts (step 40): saved when an owner
// presses Connect, used once when the platform sends them back. Only the
// state's hash is stored (lib/oauth-state.ts). Expired ones are deleted by
// the daily job (db/maintenance.ts).

export type NewOauthState = {
  // Made by the service: the PKCE verifier is encrypted with a context naming it.
  id: string;
  platform: SocialPlatform;
  stateHash: string;
  pkceVerifierEncrypted: string | null;
};

export type ClaimedOauthState = { id: string; pkceVerifierEncrypted: string | null };

// Saves one attempt while userId is an active owner of the company (the
// role read again, locked: db/knowledge-author.ts says why). It works for
// 10 minutes from now, the database's clock.
export async function createOauthState(companyId: string, userId: string, state: NewOauthState): Promise<"saved" | "not-allowed"> {
  return db.transaction(async (tx) => {
    const role = await lockActiveAuthorRole(tx, companyId, userId);
    if (!role || !canManageSocialAccounts(role)) {
      return "not-allowed";
    }
    await tx.insert(oauthStates).values({
      id: state.id,
      companyId,
      userId,
      platform: state.platform,
      stateHash: state.stateHash,
      pkceVerifierEncrypted: state.pkceVerifierEncrypted,
      expiresAt: sql`now() + make_interval(mins => ${OAUTH_STATE_LIFETIME_MINUTES})`,
    });
    return "saved";
  });
}

// Marks the attempt with this state's hash used, if it is this person's,
// in this company, for this platform, unused and unexpired, all in the one
// UPDATE that finds it. WHY one statement: of two callbacks with the same
// state at the same moment, the second waits for the first's row lock,
// then reads used_at again and matches nothing. null: no attempt matched.
export async function claimOauthState(companyId: string, userId: string, platform: SocialPlatform, stateHash: string): Promise<ClaimedOauthState | null> {
  const [used] = await db
    .update(oauthStates)
    .set({ usedAt: sql`now()` })
    .where(
      and(
        eq(oauthStates.companyId, companyId),
        eq(oauthStates.userId, userId),
        eq(oauthStates.platform, platform),
        eq(oauthStates.stateHash, stateHash),
        isNull(oauthStates.usedAt),
        gt(oauthStates.expiresAt, sql`now()`),
      ),
    )
    .returning({ id: oauthStates.id, pkceVerifierEncrypted: oauthStates.pkceVerifierEncrypted });
  return used ?? null;
}
