import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { alias, type AnyPgColumn } from "drizzle-orm/pg-core";
import type { MediaContentType, MediaKind } from "@/lib/media/kinds";
import type { PublishCheckInput } from "@/lib/publishing/run-check";
import { readConfirmedFactValues } from "./business-facts";
import { db } from "./client";
import { heldBy, type PublishClaim } from "./publish-runs";
import { autopublishRules, contentDrafts, mediaAssets, publishJobs, socialConnections, users } from "./schema";

// What the check right before a post is sent (step 41,
// lib/publishing/run-check.ts) decides on, read for one claimed job of one
// company in ONE snapshot (a repeatable read, read-only transaction): the
// job, its draft as stored now, whether the owner who approved it is still
// an active owner, its rule and whether the owners behind that are, its
// account, its image or video, and the confirmed facts now. Nothing is
// trusted from when the job was scheduled.

export type JobForPublishing = {
  check: PublishCheckInput;
  // The draft's image or video in storage (null: none attached).
  media: { storageKey: string; contentType: MediaContentType; kind: MediaKind; altText: string } | null;
};

const approver = alias(users, "approver");
const ruleCreator = alias(users, "rule_creator");
const ruleEnabler = alias(users, "rule_enabler");

// Null: this run no longer holds the job under its claim (it ended, or a
// later run has it), so it must not be sent.
export async function readJobForPublishing(claim: PublishClaim): Promise<JobForPublishing | null> {
  return db.transaction(
    async (tx) => {
      const [row] = await tx
        .select({
          approvalMode: publishJobs.approvalMode,
          approvedVersion: publishJobs.approvedVersion,
          draft: {
            status: contentDrafts.status,
            version: contentDrafts.version,
            platform: contentDrafts.platform,
            format: contentDrafts.format,
            pillar: contentDrafts.pillar,
            title: contentDrafts.title,
            body: contentDrafts.body,
            hashtags: contentDrafts.hashtags,
            callToAction: contentDrafts.callToAction,
            videoScript: contentDrafts.videoScript,
            generatedVersion: contentDrafts.generatedVersion,
            claims: contentDrafts.claims,
            factsUsed: contentDrafts.factsUsed,
            approvedByUserId: contentDrafts.approvedByUserId,
            approvedVersion: contentDrafts.approvedVersion,
          },
          approverId: approver.id,
          ruleId: autopublishRules.id,
          ruleEnabled: autopublishRules.enabled,
          rulePlatform: autopublishRules.platform,
          rulePillar: autopublishRules.pillar,
          ruleCreatorId: ruleCreator.id,
          ruleEnablerId: ruleEnabler.id,
          connectionPlatform: socialConnections.platform,
          connectionStatus: socialConnections.status,
          mediaStorageKey: mediaAssets.storageKey,
          mediaContentType: mediaAssets.contentType,
          mediaKind: mediaAssets.kind,
          mediaAltText: mediaAssets.altText,
        })
        .from(publishJobs)
        .innerJoin(contentDrafts, and(eq(contentDrafts.companyId, publishJobs.companyId), eq(contentDrafts.id, publishJobs.draftId)))
        .leftJoin(approver, and(eq(approver.companyId, publishJobs.companyId), eq(approver.id, contentDrafts.approvedByUserId), isActiveOwner(approver)))
        .leftJoin(autopublishRules, and(eq(autopublishRules.companyId, publishJobs.companyId), eq(autopublishRules.id, publishJobs.autopublishRuleId)))
        .leftJoin(ruleCreator, and(eq(ruleCreator.companyId, publishJobs.companyId), eq(ruleCreator.id, autopublishRules.createdByUserId), isActiveOwner(ruleCreator)))
        .leftJoin(ruleEnabler, and(eq(ruleEnabler.companyId, publishJobs.companyId), eq(ruleEnabler.id, autopublishRules.enabledByUserId), isActiveOwner(ruleEnabler)))
        .leftJoin(socialConnections, and(eq(socialConnections.companyId, publishJobs.companyId), eq(socialConnections.id, publishJobs.connectionId)))
        .leftJoin(mediaAssets, and(eq(mediaAssets.companyId, publishJobs.companyId), eq(mediaAssets.id, contentDrafts.mediaAssetId)))
        .where(heldBy(claim));
      if (!row) {
        return null;
      }
      const media =
        row.mediaStorageKey && row.mediaContentType && row.mediaKind
          ? { storageKey: row.mediaStorageKey, contentType: row.mediaContentType, kind: row.mediaKind, altText: row.mediaAltText ?? "" }
          : null;
      const rule =
        row.ruleId && row.rulePlatform && row.ruleEnabled !== null
          ? { enabled: row.ruleEnabled, platform: row.rulePlatform, pillar: row.rulePillar ?? "", ownersActive: row.ruleCreatorId !== null && row.ruleEnablerId !== null }
          : null;
      const connection = row.connectionPlatform && row.connectionStatus ? { platform: row.connectionPlatform, status: row.connectionStatus } : null;
      const check: PublishCheckInput = {
        approvalMode: row.approvalMode,
        approvedVersion: row.approvedVersion,
        draft: { ...row.draft, media: media ? { kind: media.kind, altText: media.altText } : null },
        approverIsActiveOwner: row.approverId !== null,
        rule,
        connection,
        facts: await readConfirmedFactValues(tx, claim.companyId),
      };
      return { check, media };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

// An active, confirmed owner of the company (the person joined as `person`).
function isActiveOwner(person: { role: AnyPgColumn; emailVerified: AnyPgColumn; deactivatedAt: AnyPgColumn }) {
  return and(eq(person.role, "owner"), eq(person.emailVerified, true), isNull(person.deactivatedAt));
}
