import "server-only";
import type { PrivateFileAccess } from "@/lib/file-storage";

// The HTTP answers of the routes that serve private files (call recordings,
// company documents, the media library), after their login and company
// checks. Never cached.

// The answer when the file can't be served: 429 after too many requests (the
// counters run for 10 minutes), 404 when there is no such file for this
// company. Kept apart so a busy person isn't told their file is gone.
export function fileUnavailableResponse(reason: "rate-limited" | null): Response {
  if (reason === "rate-limited") {
    return new Response(null, { status: 429, headers: { "retry-after": "600", "cache-control": "no-store" } });
  }
  return new Response(null, { status: 404 });
}

// The answer for a file the person may see: a redirect to a short-lived
// signed link (R2), or the bytes themselves (dev). downloadName: the file is
// always saved, never opened inside our pages.
export function privateFileResponse(access: PrivateFileAccess, downloadName?: string): Response {
  if (access.kind === "signed-url") {
    return new Response(null, { status: 302, headers: { location: access.url, "cache-control": "no-store" } });
  }
  const headers: Record<string, string> = { "content-type": access.contentType, "cache-control": "private, no-store" };
  if (downloadName) {
    headers["content-disposition"] = `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`;
    headers["x-content-type-options"] = "nosniff";
  }
  return new Response(new Uint8Array(access.bytes), { headers });
}

// The answer for an image or video of the media library (step 39), shown
// in our pages rather than saved: always with the type we stored (from the
// file's own bytes, never the browser's), "nosniff" so no browser reads it
// as anything else, and, opened on its own, a sandbox in which nothing in
// it could run. A signed R2 link carries the stored type too
// (adapters/r2.ts).
export function inlineMediaResponse(access: PrivateFileAccess, contentType: string): Response {
  const always = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" };
  if (access.kind === "signed-url") {
    return new Response(null, { status: 302, headers: { ...always, location: access.url } });
  }
  return new Response(new Uint8Array(access.bytes), {
    headers: {
      ...always,
      "content-type": contentType,
      "content-disposition": "inline",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
