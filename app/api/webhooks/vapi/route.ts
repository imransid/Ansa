import { after } from "next/server";
import { handleVapiWebhook } from "@/services/vapi-webhook";

// The call analysis after the response (Claude: up to 3 tries of 60 s) runs
// within this route's time limit, not the host's default, which can be as
// short as 10 seconds. A run cut off anyway is picked up by the scheduled job
// (services/stuck-work.ts).
export const maxDuration = 300;

// Vapi posts call events here, and the assistant's tool calls during a call
// (step 35). Signature check, parsing and saving all happen in the service,
// in that order. after() runs the call analysis once the response has been
// sent.
export async function POST(request: Request): Promise<Response> {
  return handleVapiWebhook(request, (task) => after(task));
}
