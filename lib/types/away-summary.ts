import type { HandoverReason } from "@/lib/assistant/reasons";
import type { ConversationChannel } from "@/lib/conversations";

// One line of "While you were away" (step 51): something the assistant did
// since this person last pressed "Got it" on Home.
export type AwaySummaryLine = {
  conversationId: string;
  contactName: string | null;
  channel: ConversationChannel;
  action: "replied" | "drafted" | "handed_over";
  reason: HandoverReason | null;
  createdAt: Date;
};
