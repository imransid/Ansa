import { after } from "next/server";
import { handleVapiWebhook } from "@/services/vapi-webhook";

// Vapi posts call events here. Signature check, parsing and saving all happen
// in the service, in that order. after() runs the call analysis once the
// response has been sent.
export async function POST(request: Request): Promise<Response> {
  return handleVapiWebhook(request, (task) => after(task));
}
