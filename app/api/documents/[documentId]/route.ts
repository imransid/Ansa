import { fileUnavailableResponse, privateFileResponse } from "@/lib/private-file-response";
import { getSessionContext } from "@/lib/session";
import { getDocumentForSession } from "@/services/documents";

// Download one company document. Logged-in users of that company only;
// everyone else gets 404, and too many downloads 429. Always a download,
// never shown inline, never cached.
export async function GET(_request: Request, { params }: RouteContext<"/api/documents/[documentId]">) {
  const session = await getSessionContext();
  if (!session) {
    return new Response(null, { status: 401 });
  }
  const document = await getDocumentForSession(session, (await params).documentId);
  if (document === "rate-limited" || document === null) {
    return fileUnavailableResponse(document);
  }
  return privateFileResponse(document.access, document.fileName);
}
