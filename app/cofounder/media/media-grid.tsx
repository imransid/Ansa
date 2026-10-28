import Link from "next/link";
import { deleteMediaAction } from "@/app/actions/media";
import { ConfirmButton } from "@/components/confirm-button";
import { LocalDateTime } from "@/components/local-date-time";
import { STATUSES_KEEPING_ALT_TEXT, STATUSES_KEEPING_MEDIA } from "@/lib/content-studio/draft-fields";
import { CONTENT_STATUS_LABELS } from "@/lib/content-studio/formats";
import { formatFileSize } from "@/lib/format-file-size";
import { CONTENT_TYPE_LABELS } from "@/lib/media/kinds";
import type { MediaLibraryItem } from "@/services/media-library";
import { AltTextForm } from "./alt-text-form";
import { MediaSourceBadges } from "./media-badges";
import { MediaPreview } from "./media-preview";

// The company's images and videos (step 39), newest first: each shown from
// our own route, where it came from, its details, the drafts using it, its
// alt text, and Delete (which asks first, and is refused while a draft
// that is approved, scheduled, published or failed uses it).
export function MediaGrid({ assets }: { assets: MediaLibraryItem[] }) {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {assets.map((asset) => (
        <li key={asset.id} id={`asset-${asset.id}`} className="grid content-start gap-3 rounded-lg border p-3 text-sm">
          <MediaPreview asset={asset} sizes="(min-width: 1024px) 320px, (min-width: 640px) 50vw, 100vw" />
          <div className="flex flex-wrap items-center gap-2">
            <MediaSourceBadges source={asset.source} provider={asset.provider} />
          </div>
          <p className="font-medium wrap-anywhere" title={captionOf(asset).length > 160 ? captionOf(asset) : undefined}>
            {cutForCard(captionOf(asset), 160)}
          </p>
          <p className="text-xs text-muted-foreground">
            {CONTENT_TYPE_LABELS[asset.contentType]}, {formatFileSize(asset.sizeBytes)}
            {asset.width !== null && asset.height !== null && <>, {asset.width} &times; {asset.height} pixels</>}. Added on{" "}
            <LocalDateTime iso={asset.createdAt.toISOString()} dateOnly /> by {asset.createdByName ?? "a former teammate"}.
          </p>
          <UsedBy asset={asset} />
          <AltText asset={asset} />
          <DeleteMedia asset={asset} />
        </li>
      ))}
    </ul>
  );
}

// The alt text box, or why it can't change now (the server decides again):
// it is published with the file, as the drafts using it were approved.
function AltText({ asset }: { asset: MediaLibraryItem }) {
  if (asset.usedBy.some((draft) => STATUSES_KEEPING_ALT_TEXT.includes(draft.status))) {
    return (
      <div className="grid gap-1 text-xs">
        <p className="font-medium">What it shows (alt text)</p>
        <p className="wrap-anywhere">{asset.altText || "None."}</p>
        <p className="text-muted-foreground">It can&apos;t be changed while a draft that is scheduled, published or failed to publish uses it.</p>
      </div>
    );
  }
  const approvedDrafts = asset.usedBy.filter((draft) => draft.status === "approved").length;
  return <AltTextForm assetId={asset.id} current={asset.altText} approvedDrafts={approvedDrafts} />;
}

// Delete, or why it can't be deleted now (the server decides again).
function DeleteMedia({ asset }: { asset: MediaLibraryItem }) {
  if (asset.usedBy.some((draft) => STATUSES_KEEPING_MEDIA.includes(draft.status))) {
    return (
      <p className="text-xs text-muted-foreground">
        It can&apos;t be deleted while a draft that is approved, scheduled, published or failed to publish uses it.
      </p>
    );
  }
  const losing = asset.usedBy.length === 0 ? "" : asset.usedBy.length === 1 ? " The draft using it loses it." : " The drafts using it lose it.";
  return (
    <div>
      <ConfirmButton
        action={deleteMediaAction}
        fields={{ assetId: asset.id }}
        label="Delete"
        accessibleLabel={`Delete ${cutForCard(captionOf(asset), 80)}`}
        question={`Delete this ${asset.kind}? The file is removed for good.${losing}`}
        confirmLabel="Yes, delete"
        pendingLabel="Deleting..."
      />
    </div>
  );
}

function UsedBy({ asset }: { asset: MediaLibraryItem }) {
  if (asset.usedBy.length === 0) {
    return <p className="text-xs text-muted-foreground">No draft uses it.</p>;
  }
  return (
    <div className="grid gap-1 text-xs">
      <p className="text-muted-foreground">Used by:</p>
      <ul className="grid gap-1">
        {asset.usedBy.map((draft) => (
          <li key={draft.draftId} className="wrap-anywhere">
            <Link href={`/cofounder/studio/${draft.draftId}`} className="underline">
              {draft.topic}
            </Link>{" "}
            ({CONTENT_STATUS_LABELS[draft.status]})
          </li>
        ))}
      </ul>
    </div>
  );
}

// An upload is named by its file; a generated one by what it was made from.
function captionOf(asset: MediaLibraryItem): string {
  if (asset.source === "upload") {
    return asset.originalName ?? "Uploaded file";
  }
  return asset.prompt ? `Made from: “${asset.prompt}”` : "Made by the AI";
}

// At most this many characters, whole ones.
function cutForCard(text: string, max: number): string {
  const characters = [...text];
  return characters.length > max ? `${characters.slice(0, max).join("").trimEnd()}...` : text;
}
