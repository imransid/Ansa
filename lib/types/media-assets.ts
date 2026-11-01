import type { ContentDraftStatus } from "@/lib/content-studio/formats";
import type { MediaContentType, MediaKind, MediaSource } from "@/lib/media/kinds";

// The company's media library (step 39): one asset, as a draft's media and
// the library list it, and which drafts use it.

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
