import { after } from "next/server";
import { handleTelegramWebhook } from "@/services/telegram-webhook";

// After the answer: the assistant asks Claude and replies (step 49: up to
// about 70 seconds, Claude Code longer) and the bot's notes to an owner
// go out, within this route's time limit, not the host's default.
export const maxDuration = 300;

// Telegram posts the bot's updates here (step 48): owners connecting their
// account, customers' messages. Secret check, parsing and saving all happen
// in the service, in that order.
export async function POST(request: Request): Promise<Response> {
  return handleTelegramWebhook(request, (task) => after(task));
}
