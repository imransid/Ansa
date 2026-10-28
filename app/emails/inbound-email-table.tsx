import Link from "next/link";
import { LocalDateTime } from "@/components/local-date-time";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { describeIgnoredReason, PROCESS_AGAIN_REASONS, TICKET_ANYWAY_REASONS } from "@/lib/inbound-email-reasons";
import type { InboundEmailListItem } from "@/services/inbound-emails";
import { EmailActionButton } from "./email-action-button";

// Every email that reached the company's forwarding address, and what became
// of it (step 27). Who sent it and when, never its subject or body.
export function InboundEmailTable({ emails, page }: { emails: InboundEmailListItem[]; page: number }) {
  if (emails.length === 0 && page > 1) {
    return (
      <p className="rounded-lg border p-6 text-center text-muted-foreground">
        Nothing on this page.{" "}
        <Link href="/emails" className="underline">
          Go to the first page
        </Link>
      </p>
    );
  }
  if (emails.length === 0) {
    return (
      <p className="rounded-lg border p-6 text-center text-muted-foreground">
        No emails yet. Emails forwarded to your forwarding address (Setup page) appear here.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Received</TableHead>
          <TableHead>From</TableHead>
          <TableHead>What happened</TableHead>
          <TableHead>
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {emails.map((email) => (
          <TableRow key={email.id}>
            <TableCell>
              <LocalDateTime iso={email.receivedAt.toISOString()} />
            </TableCell>
            <TableCell className="max-w-64 break-all">{email.fromAddress ?? "-"}</TableCell>
            <TableCell className="whitespace-normal">
              <WhatHappened email={email} />
            </TableCell>
            <TableCell className="text-right">
              <ActionFor email={email} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function WhatHappened({ email }: { email: InboundEmailListItem }) {
  if (email.ticketNumber !== null) {
    return (
      <Link href={`/tickets/${email.ticketNumber}`} className="underline">
        Ticket #{email.ticketNumber}
      </Link>
    );
  }
  if (email.status === "ignored") {
    return <>Not a ticket: {describeIgnoredReason(email.ignoredReason)}.</>;
  }
  if (email.stuck) {
    return <span className="text-destructive">Stuck: processing never finished.</span>;
  }
  return <>Being turned into a ticket...</>;
}

// "Process again" for an email that failed or got stuck, "Make a ticket
// anyway" for one the filters skipped. Nothing for mail from ansa's own
// addresses (own_address): making that a ticket could loop.
function ActionFor({ email }: { email: InboundEmailListItem }) {
  const reason = email.ignoredReason ?? "";
  if (email.stuck || (email.status === "ignored" && PROCESS_AGAIN_REASONS.includes(reason))) {
    return <EmailActionButton inboundEmailId={email.id} action="process-again" />;
  }
  if (email.status === "ignored" && TICKET_ANYWAY_REASONS.includes(reason)) {
    return <EmailActionButton inboundEmailId={email.id} action="ticket-anyway" />;
  }
  return null;
}
