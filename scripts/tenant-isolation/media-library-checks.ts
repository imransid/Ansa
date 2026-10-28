// Media library checks (step 39): one company's images and videos never
// reach another (services, /db and what the media route serves), the route
// shows a file inline with the type we stored, nosniff and a sandbox, and
// answers 429 (never 404) when someone asks too often; Postgres refuses
// what the code would never write; alt text is one plain line of at most
// 1,000 characters; uploads are limited; and nothing of a file's name, key
// or alt text reaches the logs. Uses the .dev-files/ stand-in only.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { deleteMediaAsset } from "@/db/media-asset-deletion";
import { updateMediaAltText } from "@/db/media-alt-text";
import { getMediaAssetForCompany, getMediaFileForCompany } from "@/db/media-assets";
import { mediaAssets } from "@/db/schema";
import { mediaContentTypes, mediaGenerationJobStatuses, mediaKinds, mediaSources } from "@/lib/media/kinds";
import { MEDIA_ALT_TEXT_MAX_LENGTH } from "@/lib/media/limits";
import { fileUnavailableResponse, inlineMediaResponse } from "@/lib/private-file-response";
import { getMediaFileForSession } from "@/services/media-files";
import { deleteMediaForSession } from "@/services/media-deletion";
import { getMediaTotalsForSession, listMediaForSession, saveMediaAltTextForSession } from "@/services/media-library";
import { isOverRateLimit, RATE_LIMITS } from "@/services/rate-limit";
import { messageOf } from "./cofounder-helpers";
import { addTeammate, assertRefusedByConstraint, captureConsole, check, runId, sessionFor, signUpTestOwner } from "./helpers";
import { assetRow, GIF, PNG, upload, uploadedAssetId } from "./media-helpers";

// The values one CHECK of a media table allows, as Postgres writes it back.
async function checkListOf(table: string, constraintName: string): Promise<string[]> {
  const result = await db.execute<{ definition: string }>(
    sql`select pg_get_constraintdef(oid) as definition from pg_constraint where conrelid = ${table}::regclass and conname = ${constraintName}`,
  );
  return [...(result.rows[0]?.definition ?? "").matchAll(/'([^']*)'::text/g)].map((match) => match[1]);
}

export async function runMediaLibraryChecks() {
  await check("media library: another company can't list, count, serve, describe or delete a company's images (services and /db); its own team can", async () => {
    const ownerAUser = await signUpTestOwner("media-a");
    const ownerA = sessionFor(ownerAUser);
    const ownerB = sessionFor(await signUpTestOwner("media-b"));
    const assetId = await uploadedAssetId(ownerA, PNG, `menu-${runId}.png`);
    const before = await assetRow(assetId);
    assert.deepEqual(await listMediaForSession(ownerB, 1), []);
    assert.equal((await getMediaTotalsForSession(ownerB)).count, 0);
    assert.equal(await getMediaFileForSession(ownerB, assetId), null);
    assert.match(messageOf(await saveMediaAltTextForSession(ownerB, { assetId, altText: "B was here" })), /couldn't find that image/);
    assert.match(messageOf(await deleteMediaForSession(ownerB, { assetId })), /couldn't find that image/);
    assert.equal(await getMediaAssetForCompany(ownerB.companyId, assetId), undefined);
    assert.equal(await getMediaFileForCompany(ownerB.companyId, assetId), undefined);
    assert.deepEqual(await updateMediaAltText(ownerB.companyId, ownerB.userId, { assetId, altText: "B" }), { outcome: "not-found" });
    assert.deepEqual(await updateMediaAltText(ownerA.companyId, ownerB.userId, { assetId, altText: "B" }), { outcome: "not-allowed" });
    assert.deepEqual(await deleteMediaAsset(ownerB.companyId, ownerB.userId, assetId), { outcome: "not-found" });
    assert.deepEqual(await deleteMediaAsset(ownerA.companyId, ownerB.userId, assetId), { outcome: "not-allowed" });
    assert.deepEqual(await assetRow(assetId), before);
    // A's member sees and gets it, the id in capitals too.
    const member = sessionFor(await addTeammate(ownerAUser, "media-member", "member"));
    assert.deepEqual((await listMediaForSession(member, 1)).map((asset) => asset.id), [assetId]);
    const file = await getMediaFileForSession(member, assetId.toUpperCase());
    assert.ok(file && file !== "rate-limited" && file.access.kind === "bytes" && file.access.bytes.equals(PNG));
  });

  await check("media route: a file is shown inline with the type we stored, nosniff and a sandbox, never cached; an unknown id answers 404 and too many 429", async () => {
    const owner = sessionFor(await signUpTestOwner("media-route"));
    const assetId = await uploadedAssetId(owner, GIF, "anim.gif");
    const file = await getMediaFileForSession(owner, assetId);
    assert.ok(file && file !== "rate-limited");
    const answer = inlineMediaResponse(file.access, file.contentType);
    assert.equal(answer.status, 200);
    assert.deepEqual(
      ["content-type", "x-content-type-options", "content-disposition", "cache-control"].map((name) => answer.headers.get(name)),
      ["image/gif", "nosniff", "inline", "private, no-store"],
    );
    assert.match(answer.headers.get("content-security-policy") ?? "", /default-src 'none'.*sandbox/);
    assert.ok(Buffer.from(await answer.arrayBuffer()).equals(GIF));
    // A signed R2 link is a redirect that is never cached either.
    const redirect = inlineMediaResponse({ kind: "signed-url", url: "https://bucket.example.test/media/x.gif?signed" }, "image/gif");
    assert.deepEqual([redirect.status, redirect.headers.get("location"), redirect.headers.get("cache-control")], [302, "https://bucket.example.test/media/x.gif?signed", "private, no-store"]);
    for (const unknown of [randomUUID(), "not-an-id", "../documents/x", ""]) {
      assert.equal(await getMediaFileForSession(owner, unknown), null, unknown);
    }
    assert.equal(fileUnavailableResponse(null).status, 404);
    const busy = sessionFor(await signUpTestOwner("media-busy"));
    const busyAsset = await uploadedAssetId(busy, GIF, "busy.gif");
    for (let view = 0; view < RATE_LIMITS.mediaViewsPerUser.maxAttempts; view++) {
      await isOverRateLimit("media-views", busy.userId, RATE_LIMITS.mediaViewsPerUser);
    }
    assert.equal(await getMediaFileForSession(busy, busyAsset), "rate-limited");
    assert.equal(fileUnavailableResponse("rate-limited").status, 429);
  });

  await check("media library: Postgres refuses a key outside the company's folder or not made from the asset's id, a person or job from another company, an upload with a job, a generated file without one, and an unknown type", async () => {
    const ownerA = sessionFor(await signUpTestOwner("media-db-a"));
    const ownerB = sessionFor(await signUpTestOwner("media-db-b"));
    const id = randomUUID();
    const row = {
      id,
      companyId: ownerA.companyId,
      kind: "image" as const,
      source: "upload" as const,
      contentType: "image/png" as const,
      sizeBytes: 10,
      storageKey: `media/${ownerA.companyId}/${id}.png`,
      originalName: "a.png",
      createdByUserId: ownerA.userId,
    };
    const refused = "media_assets_storage_key_from_ids";
    await assertRefusedByConstraint(db.insert(mediaAssets).values({ ...row, storageKey: `media/${ownerB.companyId}/${id}.png` }), refused);
    await assertRefusedByConstraint(db.insert(mediaAssets).values({ ...row, storageKey: `media/${ownerA.companyId}/${randomUUID()}.png` }), refused);
    await assertRefusedByConstraint(db.insert(mediaAssets).values({ ...row, storageKey: `media/${ownerA.companyId}/${id}.jpg` }), refused);
    await assertRefusedByConstraint(db.insert(mediaAssets).values({ ...row, storageKey: `documents/${ownerA.companyId}/${id}.png` }), refused);
    await assertRefusedByConstraint(db.insert(mediaAssets).values({ ...row, createdByUserId: ownerB.userId }), "media_assets_creator_in_same_company_fk");
    await assertRefusedByConstraint(db.insert(mediaAssets).values({ ...row, provider: "dev-stand-in" }), "media_assets_upload_fields");
    await assertRefusedByConstraint(db.insert(mediaAssets).values({ ...row, source: "generated" }), "media_assets_generated_fields");
    await assertRefusedByConstraint(db.insert(mediaAssets).values({ ...row, contentType: "image/svg+xml" as "image/png" }), "media_assets_content_type_known");
    await assertRefusedByConstraint(db.insert(mediaAssets).values({ ...row, kind: "video" }), "media_assets_kind_matches_type");
    await assertRefusedByConstraint(db.insert(mediaAssets).values({ ...row, altText: "x".repeat(MEDIA_ALT_TEXT_MAX_LENGTH + 1) }), "media_assets_alt_text_length");
    await assertRefusedByConstraint(db.insert(mediaAssets).values({ ...row, width: 10 }), "media_assets_dimensions_together");
    await assertRefusedByConstraint(db.insert(mediaAssets).values({ ...row, sizeBytes: 0 }), "media_assets_size_range");
  });

  await check("media library: the database's CHECKs list exactly the code's kinds, sources, types and job statuses", async () => {
    assert.deepEqual((await checkListOf("media_assets", "media_assets_kind_known")).sort(), [...mediaKinds].sort());
    assert.deepEqual((await checkListOf("media_generation_jobs", "media_generation_jobs_kind_known")).sort(), [...mediaKinds].sort());
    assert.deepEqual((await checkListOf("media_assets", "media_assets_source_known")).sort(), [...mediaSources].sort());
    assert.deepEqual((await checkListOf("media_assets", "media_assets_content_type_known")).sort(), [...mediaContentTypes].sort());
    assert.deepEqual((await checkListOf("media_generation_jobs", "media_generation_jobs_status_known")).sort(), [...mediaGenerationJobStatuses].sort());
  });

  await check("media library: alt text is saved as one plain line of at most 1,000 characters; 1,001 is refused and changes nothing", async () => {
    const owner = sessionFor(await signUpTestOwner("media-alt"));
    const assetId = await uploadedAssetId(owner, PNG, "loaves.png");
    assert.deepEqual(await saveMediaAltTextForSession(owner, { assetId, altText: "  Three loaves\r\non a\u202E counter  " }), { ok: true });
    assert.equal((await assetRow(assetId)).altText, "Three loaves on a counter");
    const longest = "a".repeat(MEDIA_ALT_TEXT_MAX_LENGTH);
    assert.deepEqual(await saveMediaAltTextForSession(owner, { assetId, altText: longest }), { ok: true });
    const tooLong = await saveMediaAltTextForSession(owner, { assetId, altText: `${longest}b` });
    assert.ok(!tooLong.ok && /at most 1,000 characters/.test(tooLong.errors.fieldErrors?.altText?.[0] ?? ""), JSON.stringify(tooLong));
    assert.equal((await assetRow(assetId)).altText, longest);
    // An upload takes its alt text the same way.
    assert.deepEqual(await upload(owner, GIF, "dot.gif", "A dot\nof colour"), { ok: true });
    const [newest] = await listMediaForSession(owner, 1);
    assert.equal(newest.altText, "A dot of colour");
  });

  await check("media library: one person's uploads are limited (30 per 10 minutes, another person still uploads), and storage refusing a file is a message, logged without its name or key", async () => {
    const ownerUser = await signUpTestOwner("media-limit");
    const owner = sessionFor(ownerUser);
    for (let attempt = 0; attempt < RATE_LIMITS.mediaUploadsPerUser.maxAttempts; attempt++) {
      assert.deepEqual(await upload(owner, GIF, `dot-${attempt}.gif`), { ok: true }, `refused at upload ${attempt + 1}`);
    }
    assert.match(messageOf(await upload(owner, GIF, "one-more.gif")), /Too many uploads/);
    const teammate = sessionFor(await addTeammate(ownerUser, "media-limit-mate", "member"));
    assert.deepEqual(await upload(teammate, GIF, "mine.gif"), { ok: true });
    // A plain file where the company's folder should be: every write fails.
    const otherUser = await signUpTestOwner("media-down");
    const other = sessionFor(otherUser);
    const folder = path.join(process.cwd(), ".dev-files", "media", otherUser.companyId);
    await mkdir(path.dirname(folder), { recursive: true });
    await writeFile(folder, "not a folder");
    try {
      const { result, logs } = await captureConsole(() => upload(other, PNG, `secret plan ${runId}.png`, `alt ${runId}`));
      assert.match(messageOf(result), /could not be stored right now, so nothing was saved/);
      assert.deepEqual(await listMediaForSession(other, 1), []);
      assert.equal(logs.length, 1);
      assert.match(logs[0], /^Media storage failed: /);
      assert.ok(!logs[0].includes(runId) && !logs[0].includes(otherUser.companyId), "a name, alt text or key was logged");
    } finally {
      await rm(folder, { force: true });
    }
  });
}
