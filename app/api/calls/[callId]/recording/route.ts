import { fileUnavailableResponse, privateFileResponse } from "@/lib/private-file-response";
import { getSessionContext } from "@/lib/session";
import { getRecordingForSession } from "@/services/call-recordings";

// The call page's audio player plays from here. Logged-in users of the call's
// company only; everyone else gets 404, and too many plays 429. Never cached.
export async function GET(_request: Request, { params }: RouteContext<"/api/calls/[callId]/recording">) {
  const session = await getSessionContext();
  if (!session) {
    return new Response(null, { status: 401 });
  }
  const access = await getRecordingForSession(session, (await params).callId);
  if (access === "rate-limited" || access === null) {
    return fileUnavailableResponse(access);
  }
  return privateFileResponse(access);
}
