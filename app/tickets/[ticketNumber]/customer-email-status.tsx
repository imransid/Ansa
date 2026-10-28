import type { ReactNode } from "react";
import { LocalDateTime } from "@/components/local-date-time";
import { lastDeliveryProblemFor } from "@/lib/last-delivery-problem";
import type { CustomerEmailSummary } from "@/services/customer-emails";
import type { TicketDetail } from "@/services/tickets";
import { RetryEmailButton } from "./retry-email-button";

type CustomerEmailStatusProps = {
  ticket: TicketDetail;
  latestEmail: CustomerEmailSummary | null;
};

// One line telling the expert whether the customer has been (or will be) emailed.
export function CustomerEmailStatus({ ticket, latestEmail }: CustomerEmailStatusProps) {
  if (ticket.status === "open") {
    return <OpenTicketEmailStatus customerEmail={ticket.customerEmail} latestEmail={latestEmail} />;
  }

  // Checked before any email: one from an earlier solve (before a reopen) is
  // not what happened this time.
  if (ticket.solvedWithoutEmail) {
    return <StatusLine text="Closed without emailing the customer." />;
  }

  // The "Customer email" section above already says there is none.
  if (!ticket.customerEmail && !latestEmail) {
    return null;
  }

  // Solved before an email was on file: nothing was sent, and adding an email
  // later does not send one (known gap, see CLAUDE.md).
  if (!latestEmail) {
    return (
      <StatusLine text="This ticket was solved before an email was on file, so the customer was not emailed. An owner can reopen and solve it again to email them." />
    );
  }

  if (latestEmail.status === "sent" && latestEmail.sentAt) {
    const when = <LocalDateTime iso={latestEmail.sentAt.toISOString()} />;
    if (latestEmail.deliveryProblem === "bounced") {
      return (
        <StatusLine
          text={<>Email to {latestEmail.toEmail} on {when} bounced: that address does not accept mail. Check the address with the customer.</>}
        />
      );
    }
    if (latestEmail.deliveryProblem === "complained") {
      return <StatusLine text={<>Email to {latestEmail.toEmail} on {when} was marked as spam by the customer.</>} />;
    }
    // Resend accepted it but never delivered it (step 27).
    if (latestEmail.deliveryProblem === "suppressed") {
      return (
        <StatusLine
          text={<>Email to {latestEmail.toEmail} on {when} was not delivered: that address bounced or reported spam before, so Resend no longer sends to it. Check the address with the customer.</>}
        />
      );
    }
    if (latestEmail.deliveryProblem === "failed") {
      return (
        <StatusLine
          text={<>Email to {latestEmail.toEmail} on {when} was not delivered: Resend could not send it. Check the address with the customer.</>}
        />
      );
    }
    // Real email is off (SEND_REAL_EMAIL), so it was only written to a file.
    // The folder's name helps a developer; a company's team only needs to
    // know the customer got nothing (production warns the operator at startup).
    if (latestEmail.providerMessageId?.startsWith("dev-outbox:")) {
      const where = process.env.NODE_ENV === "production" ? "not sent: sending email isn't switched on yet. Contact ansa support" : "saved to .dev-emails/ instead: real email is off, so it was not sent";
      return <StatusLine text={<>Email to {latestEmail.toEmail} on {when} was {where}.</>} />;
    }
    return <StatusLine text={<>Customer emailed at {latestEmail.toEmail} on {when}.</>} />;
  }

  // No Retry while a delivery is on its way: it would only wait for that one.
  if (latestEmail.deliveryInProgress) {
    return <StatusLine text={`Email to ${latestEmail.toEmail} is being sent. Reload the page in a moment.`} />;
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <StatusLine text={describeUnsentEmail(latestEmail)} />
      <RetryEmailButton emailId={latestEmail.id} mayAlreadyHaveBeenDelivered={latestEmail.mayAlreadyHaveBeenDelivered} />
    </div>
  );
}

// Why the latest email has not gone out. Read from the email row on every
// page load, so it is gone as soon as a Retry sends the email.
function describeUnsentEmail(email: CustomerEmailSummary): string {
  if (email.heldBackByDailyLimit) {
    return `Email to ${email.toEmail} has not been sent yet: your company reached its daily limit of customer emails. Use Retry later.`;
  }
  if (email.status === "failed") {
    return `Email to ${email.toEmail} failed to send.`;
  }
  // Still "sending" 10 minutes after it started: the server stopped mid-send.
  if (email.status === "sending") {
    return `Sending the email to ${email.toEmail} was interrupted, so it may not have gone out.`;
  }
  return `Email to ${email.toEmail} has not been sent yet.`;
}

type OpenTicketEmailStatusProps = {
  customerEmail: string | null;
  latestEmail: CustomerEmailSummary | null;
};

// Who "Mark as solved" will email, plus a warning when the last email to that
// same address bounced, was reported as spam or was not delivered (still
// shown after a reopen).
function OpenTicketEmailStatus({ customerEmail, latestEmail }: OpenTicketEmailStatusProps) {
  // The "Customer email" section above already says there is none.
  if (!customerEmail) {
    return null;
  }
  const lastProblem = lastDeliveryProblemFor(customerEmail, latestEmail);
  return (
    <div className="grid gap-1">
      <StatusLine text={`The customer will be emailed at ${customerEmail} if this is marked as solved.`} />
      {lastProblem === "bounced" && (
        <WarningLine text="The last email to this address bounced: check the address with the customer before solving." />
      )}
      {lastProblem === "complained" && (
        <WarningLine text="The customer marked the last email to this address as spam. Consider closing without emailing." />
      )}
      {(lastProblem === "suppressed" || lastProblem === "failed") && (
        <WarningLine text="The last email to this address was not delivered: check the address with the customer before solving." />
      )}
    </div>
  );
}

function StatusLine({ text }: { text: ReactNode }) {
  return <p className="min-w-0 text-sm text-muted-foreground wrap-anywhere">{text}</p>;
}

function WarningLine({ text }: { text: string }) {
  return <p className="text-sm text-destructive">{text}</p>;
}
