import "server-only";
import type { FormResult } from "@/lib/form-result";
import type { SessionContext } from "@/lib/session";
import { handBackForSession } from "./conversations";
import { closeTicketWithoutEmailForSession } from "./ticket-status";

// "Done" on a chat's open request (the "easy to use" pass of 2026-11-01):
// the request is closed without an email (a chat has none to send), and the
// conversation goes back to ansa when a person had taken it over (replying
// does), so ansa answers them again. Two steps, each its own transaction
// and checks: a refused hand back leaves the request closed, and the page
// then offers "Hand back to ansa".
export async function finishChatRequestForSession(session: SessionContext, input: { ticketId: unknown; conversationId: unknown }): Promise<FormResult> {
  const closed = await closeTicketWithoutEmailForSession(session, { ticketId: input.ticketId });
  if (!closed.ok) {
    return closed;
  }
  return handBackForSession(session, { conversationId: input.conversationId });
}
