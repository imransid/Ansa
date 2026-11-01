import type { DraftUsingMedia, MediaAssetListItem } from "@/lib/types/media-assets";

// One file of the media library (step 39) as its page lists it, with the
// drafts that use it.
export type MediaLibraryItem = MediaAssetListItem & { usedBy: DraftUsingMedia[] };
