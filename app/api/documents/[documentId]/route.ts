import { getSessionContext } from "@/lib/session";
import { getDocumentForSession } from "@/services/documents";

// Download one company document. Logged-in users of that company only;
// everyone else gets 404. Always a download, never shown inline, never cached.
export async function GET(_request: Request, { params }: RouteContext<"/api/documents/[documentId]">) {
  const session = await getSessionContext();
  const document = session ? await getDocumentForSession(session, (await params).documentId) : null;
  if (!document) {
    return new Response(null, { status: session ? 404 : 401 });
  }
  if (document.access.kind === "signed-url") {
    return new Response(null, { status: 302, headers: { location: document.access.url, "cache-control": "no-store" } });
  }
  return new Response(new Uint8Array(document.access.bytes), {
    headers: {
      "content-type": document.access.contentType,
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(document.fileName)}`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    },
  });
}
