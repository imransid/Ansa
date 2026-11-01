import "server-only";
import { sendChatMessage, type ChatDeliveryOptions, type ChatDeliveryResult, type ChatTarget } from "@/lib/chat-delivery";
import { prepareConnectionForUse } from "./social-tokens";

// Sends one message to a customer through lib/chat-delivery.ts, the only
// door. A Messenger message (step 53) needs its Facebook Page's token,
// which only services/social-tokens.ts reads: it is read here first. A Page
// that can't be used now (disconnected, needing a reconnect, its token
// unreadable) means the message isn't sent ("not_connected").
export async function sendToCustomer(
  companyId: string,
  target: ChatTarget,
  message: { id: string; text: string },
  options: ChatDeliveryOptions = {},
): Promise<ChatDeliveryResult> {
  if (target.channel !== "messenger" || !target.messenger || target.messenger.isStandIn) {
    return sendChatMessage(target, message, options);
  }
  const page = await prepareConnectionForUse(companyId, target.messenger.connectionId, { fetchFn: options.fetchFn });
  if (page.kind !== "ready") {
    return { status: "failed", error: "not_connected" };
  }
  return sendChatMessage(target, message, { ...options, messengerToken: page.target.accessToken });
}
