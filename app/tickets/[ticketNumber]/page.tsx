import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { Badge } from "@/components/ui/badge";
import { formatUtcDateTime } from "@/lib/format-date";
import { requireSessionContext } from "@/lib/session";
import { getLatestCustomerEmailForSession } from "@/services/customer-emails";
import { getDashboardSummary } from "@/services/dashboard";
import { listTeamMembersForSession } from "@/services/team";
import { getTicketForSession, type TicketDetail } from "@/services/tickets";
import { CustomerEmailSection } from "./customer-email-section";
import { CustomerEmailStatus } from "./customer-email-status";
import { TicketActions } from "./ticket-actions";

export const metadata: Metadata = { title: "Ticket - ansa" };

export default function TicketPage({
  params,
}: PageProps<"/tickets/[ticketNumber]">) {
  return (
    <main className="mx-auto grid w-full max-w-3xl gap-6 p-6">
      {/* Cache Components rule: the session and the URL's ticket number are
          only known at request time, so both are read inside <Suspense>. */}
      <Suspense fallback={<p className="text-muted-foreground">Loading...</p>}>
        <TicketContent params={params} />
      </Suspense>
    </main>
  );
}

async function TicketContent({
  params,
}: Pick<PageProps<"/tickets/[ticketNumber]">, "params">) {
  const { ticketNumber } = await params;
  const session = await requireSessionContext();
  const ticket = await getTicketForSession(session, ticketNumber);
  // Unknown number, bad number, or a number that only exists in another
  // company: all look the same, so nothing leaks about other companies.
  if (!ticket) {
    notFound();
  }

  const [summary, teamMembers, latestEmail] = await Promise.all([
    getDashboardSummary(session),
    listTeamMembersForSession(session),
    getLatestCustomerEmailForSession(session, ticket.id),
  ]);

  return (
    <>
      <AppHeader summary={summary} />
      <Link href="/dashboard" className="text-sm hover:underline">
        &larr; All tickets
      </Link>
      <TicketSummary ticket={ticket} />
      <CustomerEmailSection
        // A new key after every save puts the section back into "view" mode.
        key={`${ticket.customerEmail ?? "none"}-${ticket.customerEmailSetAt?.toISOString() ?? "never"}`}
        ticketId={ticket.id}
        customerEmail={ticket.customerEmail}
        originLine={describeEmailOrigin(ticket)}
      />
      <CustomerEmailStatus ticket={ticket} latestEmail={latestEmail} />
      <TicketActions
        ticketId={ticket.id}
        status={ticket.status}
        assignedToUserId={ticket.assignedToUserId}
        teamMembers={teamMembers.map((member) => ({ id: member.id, name: member.name }))}
        canReopen={session.role === "owner"}
      />
    </>
  );
}

function TicketSummary({ ticket }: { ticket: TicketDetail }) {
  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">
          #{ticket.ticketNumber} {ticket.subject}
        </h1>
        <Badge variant={ticket.status === "open" ? "default" : "secondary"}>
          {ticket.status}
        </Badge>
        <Badge variant="outline">{ticket.channel}</Badge>
      </div>
      <p className="whitespace-pre-wrap rounded-lg border p-4">{ticket.description}</p>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Customer</dt>
        <dd>{ticket.customerName ?? "Unknown"}</dd>
        <dt className="text-muted-foreground">Phone</dt>
        <dd>{ticket.customerPhone ?? "-"}</dd>
        <dt className="text-muted-foreground">Created (UTC)</dt>
        <dd>{formatUtcDateTime(ticket.createdAt)}</dd>
        {ticket.callId && (
          <>
            <dt className="text-muted-foreground">From call</dt>
            <dd>
              {/* The transcript stays on the call page, encrypted at rest. */}
              <Link href={`/calls/${ticket.callId}`} className="underline">
                Open the call and its transcript
              </Link>
            </dd>
          </>
        )}
        {ticket.solvedAt && (
          <>
            <dt className="text-muted-foreground">Solved (UTC)</dt>
            <dd>
              {formatUtcDateTime(ticket.solvedAt)} by {ticket.solvedByName}
            </dd>
          </>
        )}
      </dl>
    </section>
  );
}

// Where the customer's email came from, shown next to the address.
function describeEmailOrigin(ticket: TicketDetail): string | null {
  if (!ticket.customerEmail) {
    return null;
  }
  if (ticket.customerEmailSetByName && ticket.customerEmailSetAt) {
    return `entered by ${ticket.customerEmailSetByName} on ${formatUtcDateTime(ticket.customerEmailSetAt)} (UTC)`;
  }
  return "came with the ticket";
}
