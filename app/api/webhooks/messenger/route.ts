import { after, connection } from "next/server";
import { answerMessengerVerification, handleMessengerWebhook } from "@/services/messenger-webhook";

// After the answer the assistant asks Claude and replies (step 49), within
// this route's time limit, not the host's default.
export const maxDuration = 300;

// Meta's one-time check when the webhook is set up in the app (step 53).
export async function GET(request: Request): Promise<Response> {
  await connection();
  return answerMessengerVerification(new URL(request.url));
}

// Customers' messages to a connected Facebook Page. Signature check,
// parsing and saving all happen in the service, in that order.
export async function POST(request: Request): Promise<Response> {
  return handleMessengerWebhook(request, (task) => after(task));
}
