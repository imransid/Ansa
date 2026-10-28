import { cache, Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { labelAssigneeOptions, type AssigneeOption } from "@/lib/assignee-menu";
import { getSessionContext, requireSessionContext } from "@/lib/session";
import { readCustomerEmail } from "@/lib/validation/customer-email";
import { listActiveCategoryNamesForSession } from "@/services/categories";
import { getLatestCustomerEmailForSession } from "@/services/customer-emails";
import { getOriginalEmailForSession, type OriginalEmail } from "@/services/inbound-emails";
import { listAssigneeChoicesForSession, type AssignableUser } from "@/services/team";
import { getTicketHistoryForSession } from "@/services/ticket-history";
import { getTicketForSession, listOtherOpenTicketsFromCustomerForSession, type TicketDetail } from "@/services/tickets";
import { CustomerEmailSection, type EmailOrigin, type SuggestedEmail } from "./customer-email-section";
import { CustomerEmailStatus } from "./customer-email-status";
import { OriginalEmailSection } from "./original-email-section";
import { KnowledgeSection } from "./related-knowledge";
import { SameCustomerTickets } from "./same-customer-tickets";
import { TicketActions } from "./ticket-actions";
import { TicketCategoryForm } from "./ticket-category-form";
import { TicketHistorySection } from "./ticket-history";
import { TicketSummary } from "./ticket-summary";

// One read per request: the tab title and the page both need the ticket.
const readTicket = cache(getTicketForSession);

// "#412 Refund not received - ansa", so several open ticket tabs can be told
// apart. The subject is one plain line already; a long one is cut here.
export async function generateMetadata({ params }: PageProps<"/tickets/[ticketNumber]">): Promise<Metadata> {
  const { ticketNumber } = await params;
  const session = await getSessionContext();
  // Logged out: the page sends them to /login.
  if (!session) {
    return { title: "Ticket - ansa" };
  }
  const ticket = await readTicket(session, ticketNumber);
  if (!ticket) {
    return { title: "Ticket not found - ansa" };
  }
  const subject = ticket.subject.length > 60 ? `${ticket.subject.slice(0, 60).trimEnd()}...` : ticket.subject;
  return { title: `#${ticket.ticketNumber} ${subject} - ansa` };
}

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
  // Logging in brings them back to this ticket (an assignment email's link).
  const session = await requireSessionContext(`/tickets/${encodeURIComponent(ticketNumber)}`);
  const ticket = await readTicket(session, ticketNumber);
  // Unknown number, bad number, or a number that only exists in another
  // company: all look the same (./not-found.tsx), so nothing leaks about
  // other companies.
  if (!ticket) {
    notFound();
  }

  const [assigneeChoices, latestEmail, categoryNames, originalEmail, sameCustomerTickets, history] = await Promise.all([
    listAssigneeChoicesForSession(session),
    getLatestCustomerEmailForSession(session, ticket.id),
    listActiveCategoryNamesForSession(session),
    getOriginalEmailForSession(session, ticket.id),
    listOtherOpenTicketsFromCustomerForSession(session, ticket.id),
    getTicketHistoryForSession(session, ticket.id),
  ]);

  return (
    <>
      <Link href="/dashboard" className="text-sm hover:underline">
        &larr; All tickets
      </Link>
      <TicketSummary ticket={ticket} />
      <SameCustomerTickets tickets={sameCustomerTickets} />
      {originalEmail && <OriginalEmailSection email={originalEmail} />}
      <KnowledgeSection
        session={session}
        ticketNumber={ticket.ticketNumber}
        subject={ticket.subject}
        category={ticket.category}
        isSolved={ticket.status === "solved"}
      />
      <CustomerEmailSection
        // A new key after every save puts the section back into "view" mode.
        key={`${ticket.customerEmail ?? "none"}-${ticket.customerEmailSetAt?.toISOString() ?? "never"}`}
        ticketId={ticket.id}
        customerEmail={ticket.customerEmail}
        origin={describeEmailOrigin(ticket)}
        suggestions={suggestCustomerEmails(originalEmail, ticket)}
      />
      <CustomerEmailStatus ticket={ticket} latestEmail={latestEmail} />
      <TicketCategoryForm ticketId={ticket.id} category={ticket.category} categoryNames={categoryNames} />
      <TicketActions
        ticketId={ticket.id}
        ticketNumber={ticket.ticketNumber}
        status={ticket.status}
        customerEmail={ticket.customerEmail}
        assignedToUserId={ticket.assignedToUserId}
        teamMembers={listAssigneeMenu(assigneeChoices, ticket)}
        canReopen={session.role === "owner"}
      />
      <TicketHistorySection ticketId={ticket.id} ticketCreatedAt={ticket.createdAt} history={history} />
    </>
  );
}

// Where the customer's email came from, shown next to the address.
function describeEmailOrigin(ticket: TicketDetail): EmailOrigin {
  if (!ticket.customerEmail) {
    return null;
  }
  if (ticket.customerEmailSetByName && ticket.customerEmailSetAt) {
    return { setByName: ticket.customerEmailSetByName, setAtIso: ticket.customerEmailSetAt.toISOString() };
  }
  return "came-with-ticket";
}

// Addresses from the original email that were not filled in on their own,
// for "Use this address" (steps 25 and 27): the Reply-To (a contact form puts
// the customer there), and the sender unless it was filled in. None on a
// ticket closed without emailing: that was on purpose (spam, a forged
// sender), so nothing should invite emailing it later.
function suggestCustomerEmails(originalEmail: OriginalEmail | null, ticket: TicketDetail): SuggestedEmail[] {
  if (!originalEmail || ticket.solvedWithoutEmail) {
    return [];
  }
  const suggestions: SuggestedEmail[] = [];
  if (originalEmail.replyToAddress) {
    suggestions.push({ address: originalEmail.replyToAddress, kind: "reply-to" });
  }
  // A From that holds no valid address can't be saved, so it isn't offered.
  const sender = readCustomerEmail(originalEmail.fromAddress ?? "");
  if (sender && !originalEmail.senderVerified) {
    suggestions.push({ address: sender, kind: "unverified-sender" });
  }
  if (sender && originalEmail.senderVerified && originalEmail.replyToAddress) {
    suggestions.push({ address: sender, kind: "sender-with-reply-to" });
  }
  return suggestions;
}

// The "Assigned to" menu: everyone who can take tickets, with the email next
// to a name two people share (lib/assignee-menu.ts). A solved ticket may still
// be assigned to someone who can't any more (removed from the team); they are
// added, marked, so the menu doesn't pretend the ticket is unassigned. Saving
// the menu unchanged changes nothing; giving them any other ticket is refused
// (db/ticket-updates.ts).
function listAssigneeMenu(choices: AssignableUser[], ticket: TicketDetail): AssigneeOption[] {
  const currentAssigneeId = ticket.assignedToUserId;
  if (!currentAssigneeId || choices.some((person) => person.id === currentAssigneeId)) {
    return labelAssigneeOptions(choices);
  }
  const formerAssignee = { id: currentAssigneeId, name: `${ticket.assigneeName ?? "Someone"} (can't take tickets)`, email: null };
  return labelAssigneeOptions([...choices, formerAssignee]);
}
