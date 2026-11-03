import type { HandoverReason } from "@/lib/assistant/reasons";
import type { ConversationChannel } from "@/lib/conversations";

// One line of "While you were away" (step 51): something the assistant did
// since this person last pressed "Got it" on Home. An email it read and a
// call that needs you are notes, as a handover is.
export type AwaySummaryLine = {
  conversationId: string;
  contactName: string | null;
  channel: ConversationChannel;
  action: "replied" | "drafted" | "handed_over" | "email_made_request" | "call_needs_person";
  reason: HandoverReason | null;
  createdAt: Date;
};
