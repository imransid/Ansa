"use client";

import Link from "next/link";
import { describeGenerationError } from "@/lib/media/error-codes";
import { mediaLibraryLink } from "@/lib/media/library-link";
import type { DraftMediaPanel } from "@/services/draft-media";
import { CancelGenerationButton, StartGenerationNowButton } from "../../media/generation-job-buttons";
import { MediaSourceBadges } from "../../media/media-badges";
import { MediaPreview } from "../../media/media-preview";
import { RefreshWhilePending } from "@/components/refresh-while-pending";
import { MakeDraftImageButton, SetDraftMediaButton } from "./draft-media-buttons";
import { DraftMediaChoices } from "./draft-media-choices";

type DraftMediaProps = {
  draftId: string;
  // The saved version on screen: attaching makes the next one.
  version: number;
  media: DraftMediaPanel;
  // The saved image description: "Make the image with the AI" uses it.
  imagePrompt: string;
  // Unsaved changes in the editor: attaching would be about other words.
  isDirty: boolean;
  // Archived: shown, not changed.
  readOnly: boolean;
  // Scheduled (step 41): a change of its media cancels its scheduled posts.
  isScheduled: boolean;
  onPendingChange: (isPending: boolean) => void;
};

// True while an image asked at the version on screen is being made: it
// will be attached as the next version, so the editor and the media
// buttons wait (a change now would make the image land on nothing).
export function isImageComingFor(media: DraftMediaPanel): boolean {
  return media.openJob !== null && !media.openJob.isStuck && media.openJob.forThisVersion;
}

// A draft's image or video (step 39): the one attached, the AI making one
// from the image description (a post with an image), why the last one
// asked for this version wasn't made, and a choice from the media library.
// Every change is the draft's next version, without its approval; none is
// offered while the editor holds unsaved changes.
export function DraftMedia({ draftId, version, media, imagePrompt, isDirty, readOnly, isScheduled, onPendingChange }: DraftMediaProps) {
  if (!media.kind) {
    return null;
  }
  // An image being made (for any version): a new request waits until it ends.
  const isMaking = media.openJob !== null && !media.openJob.isStuck;
  const disabled = isDirty || isImageComingFor(media);
  const button = { draftId, version, disabled, onPendingChange };
  return (
    <section className="grid gap-3" aria-labelledby="draft-media">
      <h3 id="draft-media" className="font-semibold">
        Media
      </h3>
      {media.attached ? (
        <div className="grid gap-2 text-sm">
          <MediaPreview asset={media.attached} sizes="(min-width: 1024px) 400px, 100vw" />
          <div className="flex flex-wrap items-center gap-2">
            <MediaSourceBadges source={media.attached.source} provider={media.attached.provider} />
          </div>
          <p className="text-muted-foreground wrap-anywhere">
            {media.attached.altText ? `What it shows: ${media.attached.altText}` : "No description of what it shows yet."}{" "}
            <Link href={mediaLibraryLink(media.attached.id, media.attachedLibraryPage)} className="underline">
              Edit it in the media library
            </Link>
          </p>
          {!readOnly && <SetDraftMediaButton {...button} assetId="" label="Take it off the draft" />}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No {media.kind} yet: {media.kind === "image" ? "the post" : "the video"} needs one before an owner can approve it.
        </p>
      )}
      {isDirty && !readOnly && <p className="text-sm">Save or undo your changes first: attaching makes a new version.</p>}
      {isScheduled && !readOnly && <p className="text-sm">This draft is scheduled: changing its {media.kind} cancels its scheduled posts.</p>}
      {media.openJob && <OpenGenerationJob job={media.openJob} onPendingChange={onPendingChange} />}
      {media.lastFailure && !media.openJob && (
        <p className="text-sm text-destructive">Making the image failed. {describeGenerationError(media.lastFailure.code)}</p>
      )}
      <RefreshWhilePending isPending={isMaking} />
      {!readOnly && media.kind === "image" && <MakeImage media={media} imagePrompt={imagePrompt} button={button} isMaking={isMaking} />}
      {!readOnly && (
        <DraftMediaChoices {...button} kind={media.kind} choices={media.choices} attachedId={media.attached?.id ?? null} />
      )}
      <p className="text-sm">
        <Link href="/cofounder/media" className="underline">
          Upload or make one in the media library
        </Link>
      </p>
    </section>
  );
}

type MakeImageProps = {
  media: DraftMediaPanel;
  imagePrompt: string;
  button: { draftId: string; version: number; disabled: boolean; onPendingChange: (isPending: boolean) => void };
  isMaking: boolean;
};

// "Make the image with the AI", from the saved image description.
function MakeImage({ media, imagePrompt, button, isMaking }: MakeImageProps) {
  if (!media.generation.available) {
    return <p className="text-sm text-muted-foreground">Image generation isn&apos;t set up yet: upload the image in the media library.</p>;
  }
  if (isMaking) {
    return null;
  }
  return (
    <div className="grid gap-1 text-sm">
      <MakeDraftImageButton {...button} disabled={button.disabled || !imagePrompt.trim()} />
      <p className="text-xs text-muted-foreground">
        {imagePrompt.trim()
          ? `From the saved image description (Image: what it shows)${media.generation.isStandIn ? ", by the development stand-in (a flat colour)" : ""}: it is attached once it is made, and marked as AI-generated.`
          : "Describe the image first (Image: what it shows), and save."}
      </p>
    </div>
  );
}

type OpenJobProps = { job: NonNullable<DraftMediaPanel["openJob"]>; onPendingChange: (isPending: boolean) => void };

// The request made from this draft, still waiting or being made.
function OpenGenerationJob({ job, onPendingChange }: OpenJobProps) {
  const changedSince = job.forThisVersion ? "" : " The draft changed after it was asked for, so the image goes to the media library, not onto the draft.";
  if (job.isStuck) {
    return (
      <div className="grid gap-2 rounded-lg border p-3 text-sm">
        <p>
          The image this draft asked for seems stuck: its run was cut off. Start it now (or the daily job tries it again), or ask
          for a new one, which replaces it.{changedSince}
        </p>
        <div className="flex flex-wrap items-start gap-2">
          <StartGenerationNowButton jobId={job.id} onPendingChange={onPendingChange} />
          {job.status === "queued" && <CancelGenerationButton jobId={job.id} onPendingChange={onPendingChange} />}
        </div>
      </div>
    );
  }
  return (
    <div className="grid gap-2 rounded-lg border p-3 text-sm">
      <p>
        The AI is {job.status === "queued" ? "about to make" : "making"} the image.
        {job.forThisVersion ? " It is attached by itself, as the draft's next version; meanwhile the editor waits." : changedSince}
      </p>
      {job.status === "queued" && <CancelGenerationButton jobId={job.id} onPendingChange={onPendingChange} />}
    </div>
  );
}
