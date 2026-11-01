import Link from "next/link";
import { finishChatRequestAction } from "@/app/actions/conversations";
import { TicketActions } from "@/app/tickets/[ticketNumber]/ticket-actions";
import { NoteForm } from "@/app/tickets/[ticketNumber]/note-form";
import { ActionButton } from "@/components/action-button";
import { StatusDot } from "@/components/status-dot";
import type { ConversationView } from "@/lib/core-views/inbox";

type RequestBoxProps = {
  conversation: ConversationView;
  ticket: NonNullable<ConversationView["openTicket"]>;
  teamMembers: Parameters<typeof TicketActions>[0]["teamMembers"];
  // A business with more than one person who takes requests.
  canAssign: boolean;
  canReopen: boolean;
};

// "Needs you" on a conversation's page (step 47; simpler since the "easy to
// use" pass of 2026-11-01): the open request. A chat's has one main button,
// Done, and the rest folded under More; a call's or an email's keeps the
// request's own actions (an email may go to the customer).
export function RequestBox({ conversation, ticket, teamMembers, canAssign, canReopen }: RequestBoxProps) {
  return (
    <section aria-labelledby="request-heading" className="grid gap-3 rounded-2xl border p-5">
      <StatusDot tone="attention">Needs you</StatusDot>
      <h2 id="request-heading" className="text-lg font-semibold">
        {ticket.subject}
      </h2>
      {conversation.canReply && !ticket.customerEmail ? (
        // A chat (the "easy to use" pass of 2026-11-01): answer in the
        // box, then Done, which closes the request without an email (a
        // chat has none to send) and hands the conversation back to
        // ansa (services/conversation-done.ts).
        <>
          <p className="text-sm text-muted-foreground">
            ansa told them you&apos;ll get back to them. Answer them here, then press Done: ansa takes care of them again after that.
          </p>
          <ActionButton
            action={finishChatRequestAction}
            fields={{ ticketId: ticket.id, conversationId: conversation.id }}
            label="Done"
            accessibleLabel="Done: this is sorted, ansa may answer them again"
            look="primary"
          />
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">More</summary>
            <div className="mt-3 grid gap-3">
                            {canAssign && (
                <TicketActions
                  ticketId={ticket.id}
                  ticketNumber={ticket.ticketNumber}
                  status={ticket.status}
                  customerEmail={ticket.customerEmail}
                  assignedToUserId={ticket.assignedToUserId}
                  teamMembers={teamMembers}
                  canReopen={canReopen}
                />
              )}
              <NoteForm ticketId={ticket.id} />
              <Link href={`/tickets/${ticket.ticketNumber}`} className="underline">
                Open the request&apos;s own page
              </Link>
            </div>
          </details>
        </>
      ) : (
        <>
          <TicketActions
            ticketId={ticket.id}
            ticketNumber={ticket.ticketNumber}
            status={ticket.status}
            customerEmail={ticket.customerEmail}
            assignedToUserId={ticket.assignedToUserId}
            teamMembers={teamMembers}
            canReopen={canReopen}
          />
          <NoteForm ticketId={ticket.id} />
          <Link href={`/tickets/${ticket.ticketNumber}`} className="text-sm underline">
            Open the whole request (customer email, category, history)
          </Link>
        </>
      )}
    </section>
  );
}
