import { Badge } from "@/components/ui/badge";
import { CONTENT_STATUS_LABELS, type ContentDraftStatus } from "@/lib/content-studio/formats";

// An approved draft stands out; one waiting for an owner is plain; one put
// away is drawn as an outline.
const STATUS_BADGES: Record<ContentDraftStatus, "default" | "secondary" | "outline" | "destructive"> = {
  idea: "outline",
  draft: "secondary",
  approved: "default",
  rejected: "destructive",
  scheduled: "default",
  published: "default",
  failed: "destructive",
  archived: "outline",
};

// A draft's status as a badge, the same in the list and on its page.
export function DraftStatusBadge({ status }: { status: ContentDraftStatus }) {
  return <Badge variant={STATUS_BADGES[status]}>{CONTENT_STATUS_LABELS[status]}</Badge>;
}
