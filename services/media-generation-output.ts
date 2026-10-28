import "server-only";
import { downloadFromAllowedHost, type Fetcher } from "@/lib/allowed-host-download";
import type { GenerationErrorCode } from "@/lib/media/error-codes";
import { KIND_OF_CONTENT_TYPE, type MediaContentType, type MediaKind } from "@/lib/media/kinds";
import { MAX_GENERATED_MEDIA_BYTES } from "@/lib/media/limits";
import { detectMediaType } from "@/lib/media/signatures";
import type { MediaProvider, ProviderOutput } from "@/lib/media-generation";

// What an image or video service handed back for one request (step 39,
// services/media-generation-runs.ts), as bytes we may keep: fetched at once
// from the service's own hosts when it gave an address (its links expire),
// and kept only when its own bytes are an accepted file of the kind asked
// for. Otherwise a code, never a file.
//
// LOGGING RULE for this file: nothing is logged here; never an address.

// For the result's download: redirects and body together.
export const MEDIA_DOWNLOAD_TIMEOUT_MS = 30_000;

export type CheckedFile = { bytes: Buffer; contentType: MediaContentType };

// The result's bytes, if they are an accepted file of the kind asked for.
export async function fetchAndCheckOutput(output: ProviderOutput, provider: MediaProvider, kind: MediaKind, fetcher: Fetcher): Promise<CheckedFile | { code: GenerationErrorCode }> {
  let bytes: Buffer;
  if ("bytes" in output) {
    bytes = output.bytes;
  } else {
    const downloaded = await downloadFromAllowedHost(output.url, {
      allowedHosts: provider.outputHosts,
      maxBytes: MAX_GENERATED_MEDIA_BYTES,
      // What the service says the file is decides nothing: its bytes do, below.
      acceptsType: (type) => type.startsWith("image/") || type.startsWith("video/") || type === "application/octet-stream",
      timeoutMs: MEDIA_DOWNLOAD_TIMEOUT_MS,
      fetcher,
    }).catch(() => null);
    // Too big says so: trying again would fetch the same file (and pay again).
    if (downloaded === "too-large") {
      return { code: "output_too_large" };
    }
    if (!downloaded) {
      return { code: "download_failed" };
    }
    bytes = downloaded.bytes;
  }
  if (bytes.length > MAX_GENERATED_MEDIA_BYTES) {
    return { code: "output_too_large" };
  }
  const contentType = detectMediaType(bytes);
  if (!contentType || KIND_OF_CONTENT_TYPE[contentType] !== kind) {
    return { code: "unexpected_output" };
  }
  return { bytes, contentType };
}
