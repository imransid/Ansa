import { after } from "next/server";
import { handleResendWebhook } from "@/services/inbound-email-webhook";

// The work after the response (fetching the email, asking Claude: up to 3
// tries of 60 s) runs within this route's time limit, not the host's default,
// which can be as short as 10 seconds. A run cut off anyway is picked up by
// the scheduled job (services/stuck-work.ts).
export const maxDuration = 300;

// Resend posts webhooks here: received emails, bounces and spam reports.
// Signature check, parsing and saving all happen in the service, in that order.
export async function POST(request: Request): Promise<Response> {
  return handleResendWebhook(request, (task) => after(task));
}
