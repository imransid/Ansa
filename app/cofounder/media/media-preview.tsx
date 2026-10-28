import Image from "next/image";
import type { MediaKind } from "@/lib/media/kinds";

type MediaPreviewProps = {
  asset: { id: string; kind: MediaKind; altText: string };
  // The image's width on screen, for the browser ("(min-width: 1024px) 33vw, 100vw").
  sizes: string;
};

// One image or video of the media library (step 39), from /api/media/<id>:
// a login and company check, then the file. WHY unoptimized: Next's image
// optimizer would fetch the file itself, without the person's login, and
// get a 401. A video only loads its first frames until it is played.
export function MediaPreview({ asset, sizes }: MediaPreviewProps) {
  const source = `/api/media/${asset.id}`;
  if (asset.kind === "video") {
    return <video src={source} controls preload="metadata" aria-label={asset.altText || "Video"} className="aspect-video w-full rounded-md bg-muted" />;
  }
  return (
    <div className="relative aspect-square w-full overflow-hidden rounded-md bg-muted">
      <Image src={source} alt={asset.altText} fill unoptimized sizes={sizes} className="object-contain" />
    </div>
  );
}
