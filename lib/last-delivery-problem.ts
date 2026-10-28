import type { DeliveryProblem } from "@/db/schema";

type LatestEmail = { toEmail: string; deliveryProblem: DeliveryProblem | null };

// The delivery problem (bounce, spam report, or not delivered at all) an open
// ticket's page warns about: that of the
// ticket's latest "solved" email, but only while the ticket still has the
// address that email went to. Owners reopen a ticket to fix a bounced address
// (CLAUDE.md), so the warning must survive the reopen and go away once the
// address is changed. null when there is nothing to warn about.
export function lastDeliveryProblemFor(
  customerEmail: string | null,
  latestEmail: LatestEmail | null,
): DeliveryProblem | null {
  if (!customerEmail || !latestEmail) {
    return null;
  }
  if (latestEmail.toEmail !== customerEmail) {
    return null;
  }
  return latestEmail.deliveryProblem;
}
