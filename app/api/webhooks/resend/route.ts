import { after } from "next/server";
import { handleResendWebhook } from "@/services/inbound-email-webhook";

// Resend posts webhooks here (received emails now; bounces in step 17).
// Signature check, parsing and saving all happen in the service, in that order.
export async function POST(request: Request): Promise<Response> {
  return handleResendWebhook(request, (task) => after(task));
}
