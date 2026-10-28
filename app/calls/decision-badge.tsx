import { Badge } from "@/components/ui/badge";
import type { CallListItem } from "@/services/calls";

type DecisionBadgeProps = Pick<CallListItem, "analysisStatus" | "aiOutcome"> & {
  // A teammate escalated the "solved" call to a ticket (step 31).
  escalated: boolean;
};

// The call brain's verdict in one word, for the calls list and call page,
// and whether a teammate overruled a "solved".
export function DecisionBadge({ analysisStatus, aiOutcome, escalated }: DecisionBadgeProps) {
  if (analysisStatus === "pending") {
    return <Badge variant="outline">Not analyzed</Badge>;
  }
  if (analysisStatus === "analyzing") {
    return <Badge variant="outline">Analyzing...</Badge>;
  }
  if (aiOutcome === "solved" && escalated) {
    return (
      <span className="flex flex-wrap gap-1">
        <Badge variant="secondary">Solved</Badge>
        <Badge variant="default">Escalated by a teammate</Badge>
      </span>
    );
  }
  if (aiOutcome === "solved") {
    return <Badge variant="secondary">Solved</Badge>;
  }
  return <Badge variant="default">Needs a human</Badge>;
}
