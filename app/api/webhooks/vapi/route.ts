import { handleVapiWebhook } from "@/services/vapi-webhook";

// Vapi posts call events here. Signature check, parsing and saving all happen
// in the service, in that order.
export async function POST(request: Request): Promise<Response> {
  return handleVapiWebhook(request);
}
