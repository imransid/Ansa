import { fileUnavailableResponse, inlineMediaResponse } from "@/lib/private-file-response";
import { getSessionContext } from "@/lib/session";
import { getMediaFileForSession } from "@/services/media-files";

// The media library's images and videos (step 39) are shown from here.
// Logged-in users of the asset's company only; everyone else gets 404, and
// too many 429. Shown inline with the type we stored, never cached.
export async function GET(_request: Request, { params }: RouteContext<"/api/media/[assetId]">) {
  const session = await getSessionContext();
  if (!session) {
    return new Response(null, { status: 401 });
  }
  const file = await getMediaFileForSession(session, (await params).assetId);
  if (file === "rate-limited" || file === null) {
    return fileUnavailableResponse(file);
  }
  return inlineMediaResponse(file.access, file.contentType);
}
