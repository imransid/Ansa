import { formatUtcDateTime } from "@/lib/format-date";
import type { CustomerEmailSummary } from "@/services/customer-emails";
import type { TicketDetail } from "@/services/tickets";
import { RetryEmailButton } from "./retry-email-button";

type CustomerEmailStatusProps = {
  ticket: TicketDetail;
  latestEmail: CustomerEmailSummary | null;
};

// One line telling the expert whether the customer has been (or will be) emailed.
export function CustomerEmailStatus({ ticket, latestEmail }: CustomerEmailStatusProps) {
  if (!ticket.customerEmail) {
    return <StatusLine text="No customer email on file." />;
  }

  if (ticket.status === "open") {
    return (
      <StatusLine
        text={`The customer will be emailed at ${ticket.customerEmail} when this is solved.`}
      />
    );
  }

  if (!latestEmail) {
    return <StatusLine text="No email was queued for this ticket." />;
  }

  if (latestEmail.status === "sent" && latestEmail.sentAt) {
    const when = formatUtcDateTime(latestEmail.sentAt);
    // Real email is off (SEND_REAL_EMAIL), so it was only written to a file.
    if (latestEmail.providerMessageId?.startsWith("dev-outbox:")) {
      return (
        <StatusLine
          text={`Email to ${latestEmail.toEmail} saved to .dev-emails/ on ${when} (UTC). Real email is off, so it was not sent.`}
        />
      );
    }
    return <StatusLine text={`Customer emailed at ${latestEmail.toEmail} on ${when} (UTC).`} />;
  }

  const problem =
    latestEmail.status === "failed"
      ? `Email to ${latestEmail.toEmail} failed to send.`
      : `Email to ${latestEmail.toEmail} has not been sent yet.`;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <StatusLine text={problem} />
      <RetryEmailButton emailId={latestEmail.id} />
    </div>
  );
}

function StatusLine({ text }: { text: string }) {
  return <p className="text-sm text-muted-foreground">{text}</p>;
}
