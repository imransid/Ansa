import type { HandoverReason } from "@/lib/assistant/reasons";
import type { ActivityAction, ConversationChannel, ConversationHandler } from "@/lib/conversations";

// The Inbox's conversations (step 47) as its pages and Home read them: a
// row of the list, one conversation with its contact, and the lines of what
// happened in it.

export type ConversationListRow = {
  id: string;
  channel: ConversationChannel;
  displayName: string | null;
  externalId: string;
  handledBy: ConversationHandler;
  lastActivityAt: Date;
};

export type InboxRow = ConversationListRow & {
  // One line about the newest entry: a message's start, or "Phone call".
  preview: string;
  openTicket: { ticketNumber: number; subject: string } | null;
};

// One conversation of the company with its contact.
export type ConversationRow = {
  id: string;
  channel: ConversationChannel;
  displayName: string | null;
  externalId: string;
  handledBy: ConversationHandler;
  takenOverAt: Date | null;
  takenOverByName: string | null;
  // Step 51: someone the owner marked important always comes to them.
  important: boolean;
  // Telegram lets ansa reply only within 24 hours of the customer's last message.
  replyWindowOpen: boolean;
};

// One line of what happened in a conversation, for Home's "What ansa did"
// and the conversation's own history: the assistant's work (no actor) and a
// person's take over or hand back (the actor). Never a message's text.
export type ActivityRow = {
  id: string;
  conversationId: string;
  action: ActivityAction;
  // Why the assistant handed over (step 49): only on "handed_over".
  reason: HandoverReason | null;
  createdAt: Date;
  actorName: string | null;
  contactName: string | null;
  channel: ConversationChannel;
};
