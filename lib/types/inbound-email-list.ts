import type { InboundEmailStatus } from "@/db/schema";

// One received email as the Emails page lists it (step 27). No subject or
// body: those are only shown on the ticket an email became.
export type InboundEmailListItem = {
  id: string;
  receivedAt: Date;
  // Null until the content was fetched.
  fromAddress: string | null;
  status: InboundEmailStatus;
  ignoredReason: string | null;
  ticketNumber: number | null;
  // Its processing never finished (see isStuckInboundEmail).
  stuck: boolean;
};
