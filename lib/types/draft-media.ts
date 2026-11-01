import type { MediaGenerationJobStatus } from "@/lib/media/kinds";
import type { MediaAsset } from "@/lib/types/media-assets";

// What a content draft's page shows about its image or video (step 39).
export type DraftMediaPanel = {
  // What the draft's format attaches (null: a text post takes none).
  kind: "image" | "video" | null;
  attached: MediaAsset | null;
  // The page of the media library that shows the attached one (its alt text is edited there).
  attachedLibraryPage: number | null;
  // The company's newest of that kind, to pick from.
  choices: MediaAsset[];
  // The request made from this draft still waiting or being made.
  // forThisVersion: asked at the version on screen, so what it makes is
  // attached as the next version (the editor waits for it); otherwise the
  // draft changed since, and it only goes to the library.
  openJob: { id: string; status: MediaGenerationJobStatus; createdAt: Date; isStuck: boolean; forThisVersion: boolean } | null;
  // The newest request made at the version on screen, when it failed: its code (lib/media/error-codes.ts).
  lastFailure: { code: string } | null;
  // Whether "Make the image with the AI" can ask anyone, and whether that is the stand-in.
  generation: { available: boolean; isStandIn: boolean };
};
