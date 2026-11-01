import type { DeliveryProblem, EmailStatus } from "@/db/schema";

// The ticket page's view of a customer email (the "solved" email).
export type CustomerEmailSummary = {
  id: string;
  status: EmailStatus;
  toEmail: string;
  sentAt: Date | null;
  providerMessageId: string | null;
  deliveryProblem: DeliveryProblem | null;
  // Its last delivery attempt was held back by the company's daily limit.
  heldBackByDailyLimit: boolean;
  // A delivery is on its way right now, so the page offers no Retry yet.
  deliveryInProgress: boolean;
  // Its first try was 23 or more hours ago, past what Resend's idempotency
  // key covers: Retry asks before sending it again.
  mayAlreadyHaveBeenDelivered: boolean;
};
