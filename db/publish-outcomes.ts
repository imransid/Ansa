import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import type { CofounderActivityAction } from "@/lib/publishing/activity-actions";
import { db, type DbTransaction } from "./client";
import { recordActivity } from "./cofounder-activity";
import { syncDraftWithJobs } from "./publish-draft-sync";
import { heldBy, type PublishClaim } from "./publish-runs";
import { contentDrafts, publishJobs } from "./schema";
import { markNeedsReauthWithin } from "./social-connection-tokens";

// What became of one claimed publish job (step 41), each outcome in ONE
// transaction: the draft's row locked first (the lock order everywhere),
// the job changed only while this run still holds it ("publishing" under
// its claim id, so a late writer never undoes what another decided),
// the draft's status following its jobs, and the outcome recorded in the
// activity log, by the app (no actor). False: the run lost the job
// meanwhile (it was handed to a person as cut off), and nothing changed.

type ActivityOfOutcome = { action: CofounderActivityAction; code: string | null };

// The platform made the post.
export async function recordJobPublished(claim: PublishClaim, post: { externalPostId: string; url: string | null }): Promise<boolean> {
  return finishClaim(claim, { action: "published", code: null }, async (tx) =>
    updateHeldJob(tx, claim, {
      status: "published",
      publishedAt: sql`now()`,
      externalPostId: post.externalPostId,
      externalUrl: post.url,
      lastError: null,
    }),
  );
}

// Nothing went out, and why. tokenRejected: the platform refused the
// account's token, so the account is marked as needing a reconnect too,
// while it still holds the token the run used (the encrypted value as
// stored): a reconnect meanwhile stands.
export async function recordJobFailed(claim: PublishClaim, code: string, tokenRejected: { storedAccessToken: string } | null = null): Promise<boolean> {
  return finishClaim(claim, { action: "publish_failed", code }, async (tx) => {
    const failed = await updateHeldJob(tx, claim, { status: "failed", lastError: code });
    if (failed && tokenRejected) {
      await markNeedsReauthWithin(tx, claim.companyId, claim.connectionId, tokenRejected.storedAccessToken, "token_rejected");
    }
    return failed;
  });
}

// The platform may have made the post: a person checks the account. It is
// never sent again by itself (IMPLEMENTATION_PLAN decision 8).
export async function recordJobNeedsAttention(claim: PublishClaim, code: string): Promise<boolean> {
  return finishClaim(claim, { action: "needs_attention", code }, async (tx) => updateHeldJob(tx, claim, { status: "needs_attention", lastError: code }));
}

// Back in the queue, tried again in waitSeconds: nothing went out. A
// platform asking to slow down counts this try (countsAsTry); the
// company's daily limit asked nobody, so its try is taken back.
export async function requeueClaimedJob(claim: PublishClaim, retry: { waitSeconds: number; code: string; countsAsTry: boolean }): Promise<boolean> {
  return finishClaim(claim, { action: "publish_delayed", code: retry.code }, async (tx) =>
    updateHeldJob(tx, claim, {
      status: "queued",
      runAfter: sql`now() + make_interval(secs => ${retry.waitSeconds})`,
      lastError: retry.code,
      attempts: retry.countsAsTry ? sql`${publishJobs.attempts}` : sql`${publishJobs.attempts} - 1`,
    }),
  );
}

// The steps every outcome shares: the draft locked, the job written while
// this run holds it, the draft's status, the activity row.
async function finishClaim(claim: PublishClaim, activity: ActivityOfOutcome, write: (tx: DbTransaction) => Promise<boolean>): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx
      .select({ id: contentDrafts.id })
      .from(contentDrafts)
      .where(and(eq(contentDrafts.companyId, claim.companyId), eq(contentDrafts.id, claim.draftId)))
      .for("update");
    if (!(await write(tx))) {
      return false;
    }
    await syncDraftWithJobs(tx, claim.companyId, claim.draftId);
    const entry = { ...activity, actorUserId: null, draftId: claim.draftId, jobId: claim.jobId, connectionId: claim.connectionId };
    await recordActivity(tx, claim.companyId, [entry]);
    return true;
  });
}

// Writes the job while this run still holds it. True when it did. Only the
// functions above call it, each naming its columns (nothing from outside
// /db reaches `change`).
async function updateHeldJob(tx: DbTransaction, claim: PublishClaim, change: PgUpdateSetSource<typeof publishJobs>): Promise<boolean> {
  const changed = await tx
    .update(publishJobs)
    .set({ ...change, updatedAt: sql`now()` })
    .where(heldBy(claim))
    .returning({ id: publishJobs.id });
  return changed.length > 0;
}
