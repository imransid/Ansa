import { Badge } from "@/components/ui/badge";
import { PUBLISH_JOB_STATUS_LABELS, type PublishJobStatus } from "@/lib/publishing/kinds";

// A post on its way is plain; one out is filled; one that didn't go out, or
// may not have, is marked; one taken out of the queue is an outline. The
// words are always there too: the colour alone never says it.
const STATUS_BADGES: Record<PublishJobStatus, "default" | "secondary" | "outline" | "destructive"> = {
  queued: "secondary",
  publishing: "secondary",
  published: "default",
  failed: "destructive",
  canceled: "outline",
  needs_attention: "destructive",
};

// A post's status as a badge, the same on the queue, the calendar and a draft's page.
export function JobStatusBadge({ status }: { status: PublishJobStatus }) {
  return <Badge variant={STATUS_BADGES[status]}>{PUBLISH_JOB_STATUS_LABELS[status]}</Badge>;
}
