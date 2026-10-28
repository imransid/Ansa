import Link from "next/link";
import { LocalDateTime } from "@/components/local-date-time";
import type { UndeliveredCustomerEmail } from "@/services/undelivered-emails";

// Customer "solved" emails that never reached the customer (step 27). Shown
// only when there are some: each one is a customer who was never told their
// request is solved. The ticket page has the details and Retry.
export function UndeliveredCustomerEmails({ emails, total }: { emails: UndeliveredCustomerEmail[]; total: number }) {
  if (emails.length === 0) {
    return null;
  }
  return (
    <section className="grid gap-2 rounded-lg border border-destructive/50 p-4">
      <h2 className="text-lg font-semibold">Customer emails not delivered ({total})</h2>
      <p className="text-sm text-muted-foreground">
        These customers were not told that their request is solved. Open the ticket to retry, or to check the address.
      </p>
      <ul className="grid gap-1 text-sm">
        {emails.map((email) => (
          <li key={email.emailId}>
            <Link href={`/tickets/${email.ticketNumber}`} className="font-medium underline">
              Ticket #{email.ticketNumber}
            </Link>
            : email to {email.toEmail} {describeProblem(email)} (<LocalDateTime iso={email.changedAt.toISOString()} />)
          </li>
        ))}
      </ul>
      {total > emails.length && <p className="text-sm text-muted-foreground">Showing the {emails.length} most recent.</p>}
    </section>
  );
}

function describeProblem(email: UndeliveredCustomerEmail): string {
  if (email.deliveryProblem === "bounced") {
    return "bounced";
  }
  if (email.deliveryProblem === "suppressed") {
    return "was not sent by Resend: that address bounced or reported spam before";
  }
  if (email.deliveryProblem === "failed") {
    return "could not be delivered by Resend";
  }
  if (email.heldBackByDailyLimit) {
    return "is waiting: your company reached its daily email limit";
  }
  if (email.status === "failed") {
    return "failed to send";
  }
  return "was not sent (sending was cut off)";
}
