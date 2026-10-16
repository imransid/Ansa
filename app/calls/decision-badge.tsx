import { Badge } from "@/components/ui/badge";
import type { CallListItem } from "@/services/calls";

type DecisionBadgeProps = Pick<CallListItem, "analysisStatus" | "aiOutcome">;

// The call brain's verdict in one word, for the calls list and call page.
export function DecisionBadge({ analysisStatus, aiOutcome }: DecisionBadgeProps) {
  if (analysisStatus === "pending") {
    return <Badge variant="outline">Not analyzed</Badge>;
  }
  if (analysisStatus === "analyzing") {
    return <Badge variant="outline">Analyzing...</Badge>;
  }
  if (aiOutcome === "solved") {
    return <Badge variant="secondary">Solved</Badge>;
  }
  return <Badge variant="default">Needs a human</Badge>;
}
