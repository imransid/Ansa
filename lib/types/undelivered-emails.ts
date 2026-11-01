import type { DeliveryProblem, EmailStatus } from "@/db/schema";

// Customer "solved" emails that never reached the customer (step 27), for the
// short list on the Emails page and the notice on the dashboard: otherwise
// they only show as one line on each ticket's page, which nobody opens again.

export type UndeliveredCustomerEmail = {
  emailId: string;
  ticketNumber: number;
  toEmail: string;
  status: EmailStatus;
  deliveryProblem: DeliveryProblem | null;
  heldBackByDailyLimit: boolean;
  // When the row last changed: queued, tried, or reported by Resend.
  changedAt: Date;
};
