import { isCoreOn } from "@/lib/core-api";
import { getRecordingFromCore } from "@/lib/core-views/call-recording";
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
  const { callId } = await params;
  // The new backend when it is switched on (lib/core-api.ts), else services/.
  const access = isCoreOn() ? await getRecordingFromCore(callId) : await getRecordingForSession(session, callId);
  if (access === "rate-limited" || access === null) {
    return fileUnavailableResponse(access);
  }
  return privateFileResponse(access);
}
