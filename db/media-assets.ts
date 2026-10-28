import "server-only";
import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import type { ContentDraftStatus } from "@/lib/content-studio/formats";
import type { MediaContentType, MediaKind, MediaSource } from "@/lib/media/kinds";
import { PAGE_SIZE, pageOffset } from "@/lib/pagination";
import { db } from "./client";
import { lockActiveAuthorRole } from "./knowledge-author";
import { contentDrafts, mediaAssets, mediaGenerationJobs, users } from "./schema";

// One company's media library (step 39): the list and its totals, one
// asset (to serve or show), the newest of one kind (a draft's picker),
// which drafts use which asset, a new upload, and where assets stand in the
// list. Alt text: db/media-alt-text.ts; deleting: db/media-asset-deletion.ts;
// generated assets: db/media-generation-runs.ts.
// Anyone active in the company writes: the role is read again, locked, in
// each transaction (db/knowledge-author.ts says why).

export type MediaAsset = {
  id: string;
  kind: MediaKind;
  source: MediaSource;
  contentType: MediaContentType;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  originalName: string | null;
  altText: string;
  provider: string | null;
  createdAt: Date;
};

export type MediaAssetListItem = MediaAsset & {
  createdByName: string | null;
  // A generated one: what it was asked for (its job's prompt).
  prompt: string | null;
};

export type DraftUsingMedia = { assetId: string; draftId: string; topic: string; status: ContentDraftStatus };

// A file in storage, as the services need it to upload, serve or remove it.
export type NewUploadedAsset = Omit<MediaAsset, "source" | "provider" | "createdAt"> & { storageKey: string; originalName: string };

const assetColumns = {
  id: mediaAssets.id,
  kind: mediaAssets.kind,
  source: mediaAssets.source,
  contentType: mediaAssets.contentType,
  sizeBytes: mediaAssets.sizeBytes,
  width: mediaAssets.width,
  height: mediaAssets.height,
  originalName: mediaAssets.originalName,
  altText: mediaAssets.altText,
  provider: mediaAssets.provider,
  createdAt: mediaAssets.createdAt,
};

// Lists one page of one company's assets, newest first, with who added each
// and, for a generated one, its prompt. Every join also matches company_id.
export async function getMediaAssetsForCompany(companyId: string, page: number): Promise<MediaAssetListItem[]> {
  return db
    .select({ ...assetColumns, createdByName: users.name, prompt: mediaGenerationJobs.prompt })
    .from(mediaAssets)
    .leftJoin(users, and(eq(users.id, mediaAssets.createdByUserId), eq(users.companyId, mediaAssets.companyId)))
    .leftJoin(mediaGenerationJobs, and(eq(mediaGenerationJobs.id, mediaAssets.generationJobId), eq(mediaGenerationJobs.companyId, mediaAssets.companyId)))
    .where(eq(mediaAssets.companyId, companyId))
    .orderBy(desc(mediaAssets.createdAt), desc(mediaAssets.id))
    .limit(PAGE_SIZE)
    .offset(pageOffset(page));
}

// How many assets one company keeps, and their size together, in bytes.
export async function getMediaTotalsForCompany(companyId: string): Promise<{ count: number; totalBytes: number }> {
  const [totals] = await db
    .select({
      count: count(),
      // sum() of integers comes back as a bigint, which the driver hands over as text.
      totalBytes: sql<number>`coalesce(sum(${mediaAssets.sizeBytes}), 0)`.mapWith(Number),
    })
    .from(mediaAssets)
    .where(eq(mediaAssets.companyId, companyId));
  return { count: totals?.count ?? 0, totalBytes: totals?.totalBytes ?? 0 };
}

// Reads one asset of one company, or undefined (unknown, or another company's).
export async function getMediaAssetForCompany(companyId: string, assetId: string): Promise<MediaAsset | undefined> {
  const [asset] = await db
    .select(assetColumns)
    .from(mediaAssets)
    .where(and(eq(mediaAssets.companyId, companyId), eq(mediaAssets.id, assetId)));
  return asset;
}

// Where one asset of one company is stored, and its type, to serve it.
export async function getMediaFileForCompany(companyId: string, assetId: string): Promise<{ storageKey: string; contentType: MediaContentType } | undefined> {
  const [file] = await db
    .select({ storageKey: mediaAssets.storageKey, contentType: mediaAssets.contentType })
    .from(mediaAssets)
    .where(and(eq(mediaAssets.companyId, companyId), eq(mediaAssets.id, assetId)));
  return file;
}

// The newest assets of one kind of one company: what a draft's page offers to attach.
export async function getMediaChoicesForCompany(companyId: string, kind: MediaKind, limit: number): Promise<MediaAsset[]> {
  return db
    .select(assetColumns)
    .from(mediaAssets)
    .where(and(eq(mediaAssets.companyId, companyId), eq(mediaAssets.kind, kind)))
    .orderBy(desc(mediaAssets.createdAt), desc(mediaAssets.id))
    .limit(limit);
}

// The drafts of one company that use these assets, last changed first.
export async function getDraftsUsingMedia(companyId: string, assetIds: string[]): Promise<DraftUsingMedia[]> {
  if (assetIds.length === 0) {
    return [];
  }
  const drafts = await db
    .select({ assetId: contentDrafts.mediaAssetId, draftId: contentDrafts.id, topic: contentDrafts.topic, status: contentDrafts.status })
    .from(contentDrafts)
    .where(and(eq(contentDrafts.companyId, companyId), inArray(contentDrafts.mediaAssetId, assetIds)))
    .orderBy(desc(contentDrafts.updatedAt));
  return drafts.flatMap((draft) => (draft.assetId ? [{ ...draft, assetId: draft.assetId }] : []));
}

// Records an uploaded file of one company (already in storage), added by
// actorUserId while they are active in it.
export async function insertUploadedMediaAsset(companyId: string, actorUserId: string, asset: NewUploadedAsset): Promise<"saved" | "not-allowed"> {
  return db.transaction(async (tx) => {
    if (!(await lockActiveAuthorRole(tx, companyId, actorUserId))) {
      return "not-allowed";
    }
    // Every column named, never a spread of `asset`: an object with extra
    // fields (a company, a source, a job of its own) can't write them.
    await tx.insert(mediaAssets).values({
      id: asset.id,
      companyId,
      kind: asset.kind,
      source: "upload",
      contentType: asset.contentType,
      sizeBytes: asset.sizeBytes,
      width: asset.width,
      height: asset.height,
      storageKey: asset.storageKey,
      originalName: asset.originalName,
      altText: asset.altText,
      createdByUserId: actorUserId,
    });
    return "saved";
  });
}

// Where each of these assets of one company stands in its library, newest
// first as the library lists them (1 = the newest): the media page shows 50
// to a page, so a link to one names its page. Unknown ids are left out.
export async function getLibraryPositionsOfAssets(companyId: string, assetIds: string[]): Promise<Map<string, number>> {
  if (assetIds.length === 0) {
    return new Map();
  }
  const ranked = db
    .select({
      id: mediaAssets.id,
      position: sql<number>`row_number() over (order by ${mediaAssets.createdAt} desc, ${mediaAssets.id} desc)`.mapWith(Number).as("position"),
    })
    .from(mediaAssets)
    .where(eq(mediaAssets.companyId, companyId))
    .as("ranked");
  const rows = await db.select({ id: ranked.id, position: ranked.position }).from(ranked).where(inArray(ranked.id, assetIds));
  return new Map(rows.map((row) => [row.id, row.position]));
}
