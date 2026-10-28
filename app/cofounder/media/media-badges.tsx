import { Badge } from "@/components/ui/badge";
import { DEV_STAND_IN_PROVIDER, type MediaSource } from "@/lib/media/kinds";

// Where an image or video came from, the same everywhere one shows (step
// 39): the library, a draft's media and its preview. Every generated one is
// marked as AI-generated, and the development stand-in's as that too.
export function MediaSourceBadges({ source, provider }: { source: MediaSource; provider: string | null }) {
  if (source === "upload") {
    return <Badge variant="outline">Uploaded</Badge>;
  }
  return (
    <>
      <Badge variant="secondary">AI-generated</Badge>
      {provider === DEV_STAND_IN_PROVIDER && <Badge variant="outline">Development stand-in</Badge>}
    </>
  );
}
