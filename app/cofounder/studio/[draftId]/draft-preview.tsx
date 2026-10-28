"use client";

import { useState } from "react";
import { composePublishedText, type DraftContent } from "@/lib/content-rules";
import { cutForFeed } from "@/lib/content-studio/feed-preview";
import { DEV_STAND_IN_PROVIDER } from "@/lib/media/kinds";
import { SOCIAL_PLATFORM_LABELS } from "@/lib/social-platforms";
import type { MediaAsset } from "@/services/draft-media";
import { MediaPreview } from "../../media/media-preview";

type DraftPreviewProps = {
  content: DraftContent;
  // The confirmed business name, or null.
  businessName: string | null;
  // The image or video attached from the media library (step 39), or null.
  media: MediaAsset | null;
};

// Roughly how the platform shows the post (step 38): the text it publishes
// (body, call to action, hashtags), cut where its feed cuts it behind "see
// more" (which opens the rest, as on the platform), and its image or video
// (step 39), or where it goes. Text is shown as text, never as HTML.
export function DraftPreview({ content, businessName, media }: DraftPreviewProps) {
  const platform = SOCIAL_PLATFORM_LABELS[content.platform];
  return (
    <section className="grid gap-2" aria-labelledby="draft-preview">
      <h3 id="draft-preview" className="font-semibold">
        Preview
      </h3>
      <p className="text-xs text-muted-foreground">Roughly how {platform} shows it: apps differ by screen.</p>
      {content.platform === "youtube" ? (
        <VideoPreview content={content} author={businessName ?? "Your channel"} media={media} />
      ) : (
        <FeedPreview content={content} author={businessName ?? "Your account"} media={media} />
      )}
    </section>
  );
}

function FeedPreview({ content, author, media }: { content: DraftContent; author: string; media: MediaAsset | null }) {
  return (
    <div className="grid gap-3 rounded-lg border bg-background p-4 text-sm">
      <div className="flex items-center gap-2">
        <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-muted font-semibold">
          {author.slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0 truncate font-semibold">{author}</span>
      </div>
      <PublishedText content={content} />
      {content.format !== "post" && <PostMedia media={media} kind={content.format === "video" ? "video" : "image"} />}
    </div>
  );
}

function VideoPreview({ content, author, media }: { content: DraftContent; author: string; media: MediaAsset | null }) {
  return (
    <div className="grid gap-3 rounded-lg border bg-background p-4 text-sm">
      <PostMedia media={media} kind="video" />
      <p className="line-clamp-2 text-base font-semibold wrap-anywhere">{content.title.trim() || "(no title yet)"}</p>
      <p className="font-medium">{author}</p>
      <div className="rounded-lg bg-muted p-3">
        <PublishedText content={content} />
      </div>
    </div>
  );
}

// The published text with hashtags drawn as links, cut behind "see more"
// until that is clicked.
function PublishedText({ content }: { content: DraftContent }) {
  const [isOpen, setIsOpen] = useState(false);
  const text = composePublishedText(content);
  if (!text) {
    return <p className="text-muted-foreground">(no text yet)</p>;
  }
  const feed = cutForFeed(content.platform, text);
  const shown = isOpen || !feed.moreLabel ? text : feed.shown;
  return (
    <p className="whitespace-pre-wrap wrap-anywhere">
      {withHashtags(shown)}
      {!isOpen && feed.moreLabel && (
        <>
          {" "}
          <button type="button" className="text-muted-foreground hover:underline" onClick={() => setIsOpen(true)}>
            {feed.moreLabel}
          </button>
        </>
      )}
    </p>
  );
}

// Each "#word" as the platforms show it, in their link colour.
function withHashtags(text: string) {
  return text.split(/(#[\p{L}\p{M}\p{N}_]+)/u).map((part, index) =>
    index % 2 === 1 ? (
      <span key={index} className="text-sky-700">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

// The attached image or video, marked when the AI made it (and when the
// development stand-in did, as everywhere it shows); or where it goes.
function PostMedia({ media, kind }: { media: MediaAsset | null; kind: "image" | "video" }) {
  if (media) {
    return (
      <div className="grid gap-1">
        <MediaPreview asset={media} sizes="(min-width: 1024px) 400px, 100vw" />
        {media.source === "generated" && (
          <p className="text-xs text-muted-foreground">
            AI-generated{media.provider === DEV_STAND_IN_PROVIDER ? " (Development stand-in)" : ""}
          </p>
        )}
      </div>
    );
  }
  return (
    <div className="grid aspect-video place-items-center rounded-lg border border-dashed bg-muted text-xs text-muted-foreground">
      {kind === "video" ? "The video goes here (not attached yet)" : "The image goes here (not attached yet)"}
    </div>
  );
}
