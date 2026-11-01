import type { MediaGenerationJobStatus, MediaKind } from "@/lib/media/kinds";

// The company's image and video requests (step 39) as the media page lists
// them, and what it says about image generation on this server.

export type GenerationJobListItem = {
  id: string;
  kind: MediaKind;
  prompt: string;
  provider: string;
  status: MediaGenerationJobStatus;
  attempts: number;
  lastError: string | null;
  costCents: number | null;
  // What it made, while that asset exists; when it was deleted since.
  assetId: string | null;
  assetDeletedAt: Date | null;
  draftId: string | null;
  draftTopic: string | null;
  // What that draft has attached now: this job's asset, or something else.
  draftMediaAssetId: string | null;
  requestedByName: string | null;
  createdAt: Date;
  finishedAt: Date | null;
  // Waiting or being made for so long that its run was surely cut off:
  // anyone may start it again (a claim still decides who runs it).
  isStuck: boolean;
};

// One request as the media page lists it: libraryPage is the page of the
// library that shows what it made (null: nothing, or deleted since).
export type GenerationJobListEntry = GenerationJobListItem & { libraryPage: number | null };

// What the pages say about image generation on this server: whether anyone
// can be asked, whether that is the development stand-in, and whether it
// makes videos too.
export type GenerationAvailability = { available: boolean; isStandIn: boolean; makesVideo: boolean };
