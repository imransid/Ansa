import { getSessionContext } from "@/lib/session";
import { getRecordingForSession } from "@/services/call-recordings";

// The call page's audio player plays from here. Logged-in users of the call's
// company only; everyone else gets 404. Never cached.
export async function GET(_request: Request, { params }: RouteContext<"/api/calls/[callId]/recording">) {
  const session = await getSessionContext();
  const access = session ? await getRecordingForSession(session, (await params).callId) : null;
  if (!access) {
    return new Response(null, { status: session ? 404 : 401 });
  }
  if (access.kind === "signed-url") {
    return new Response(null, { status: 302, headers: { location: access.url, "cache-control": "no-store" } });
  }
  return new Response(new Uint8Array(access.bytes), { headers: { "content-type": access.contentType, "cache-control": "private, no-store" } });
}
