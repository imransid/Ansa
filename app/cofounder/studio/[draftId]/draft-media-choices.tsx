"use client";

import { MEDIA_CHOICES_SHOWN } from "@/lib/media/limits";
import type { MediaAsset } from "@/services/draft-media";
import { MediaSourceBadges } from "../../media/media-badges";
import { MediaPreview } from "../../media/media-preview";
import { SetDraftMediaButton } from "./draft-media-buttons";

type DraftMediaChoicesProps = {
  draftId: string;
  version: number;
  kind: "image" | "video";
  // The company's newest of that kind (MEDIA_CHOICES_SHOWN at most).
  choices: MediaAsset[];
  attachedId: string | null;
  disabled: boolean;
  onPendingChange: (isPending: boolean) => void;
};

// "Choose from the media library" on a draft's page (step 39): the newest
// images (or videos) of the company, each with "Use this", which attaches
// it as the draft's next version. Closed until opened, so the page stays
// short (and its images, loaded lazily, wait until then).
export function DraftMediaChoices({ draftId, version, kind, choices, attachedId, disabled, onPendingChange }: DraftMediaChoicesProps) {
  const others = choices.filter((choice) => choice.id !== attachedId);
  if (others.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        There are no {attachedId ? "other " : ""}
        {kind}s in the media library yet.
      </p>
    );
  }
  return (
    <details className="grid gap-3 text-sm">
      <summary className="cursor-pointer font-medium">
        Choose {attachedId ? "another" : kind === "image" ? "an" : "a"} {kind} from the media library
        {choices.length === MEDIA_CHOICES_SHOWN ? ` (the newest ${MEDIA_CHOICES_SHOWN})` : ""}
      </summary>
      {/* Two columns, each no wider than its cell (grid-cols-1 is
          minmax(0, 1fr)): a wide badge must not push a card over the next. */}
      <ul className="mt-3 grid grid-cols-2 gap-3">
        {others.map((choice) => (
          <li key={choice.id} className="grid min-w-0 grid-cols-1 content-start gap-2">
            <MediaPreview asset={choice} sizes="160px" />
            <div className="flex flex-wrap gap-1">
              <MediaSourceBadges source={choice.source} provider={choice.provider} />
            </div>
            <SetDraftMediaButton
              draftId={draftId}
              version={version}
              assetId={choice.id}
              label="Use this"
              accessibleLabel={`Use this ${kind}${choice.originalName ? `: ${choice.originalName}` : ""}`}
              disabled={disabled}
              onPendingChange={onPendingChange}
            />
          </li>
        ))}
      </ul>
    </details>
  );
}
