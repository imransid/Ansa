import "server-only";
import { readStreamWithLimit } from "./read-raw-body";

// Downloads a file from a URL an outside service handed us: a call
// recording in a signed Vapi webhook (step 14, lib/recording-download.ts),
// or an image or video an image service made (step 39). The server fetching
// a URL it was handed is a classic attack ("SSRF": making us call internal
// addresses), so every URL, including every redirect, must be https on an
// allowed host. The URL is never logged.

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

export type DownloadedFile = { bytes: Buffer; contentType: string };

export type DownloadRules = {
  // Exact host names, lowercase.
  allowedHosts: readonly string[];
  maxBytes: number;
  // The Content-Type (without parameters, lowercase) the file may have.
  acceptsType: (contentType: string) => boolean;
  // For the whole download: every redirect and the body.
  timeoutMs: number;
  fetcher: Fetcher;
};

const MAX_REDIRECTS = 3;

// Says whether a URL may be fetched: https, an exact allowed host, default
// port, and no user name or password in it.
export function isAllowedHostUrl(rawUrl: string, allowedHosts: readonly string[]): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    url.username === "" &&
    url.password === "" &&
    (url.port === "" || url.port === "443") &&
    allowedHosts.includes(url.hostname.toLowerCase())
  );
}

// Returns the file; "too-large" when it is (by its stated length, or while
// it arrives), so a caller can say that trying again won't help; or null if
// any other rule is broken (bad URL or redirect, a type it doesn't accept,
// server error).
export async function downloadFromAllowedHost(rawUrl: string, rules: DownloadRules): Promise<DownloadedFile | "too-large" | null> {
  const signal = AbortSignal.timeout(rules.timeoutMs);
  let currentUrl = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isAllowedHostUrl(currentUrl, rules.allowedHosts)) {
      return null;
    }
    // redirect: "manual", so a redirect to a forbidden host is never requested.
    const response = await rules.fetcher(currentUrl, { redirect: "manual", signal });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        return null;
      }
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }
    if (!response.ok) {
      return null;
    }
    const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!rules.acceptsType(contentType)) {
      return null;
    }
    const bytes = await readStreamWithLimit(response.body, response.headers.get("content-length"), rules.maxBytes);
    return bytes === "too-large" ? "too-large" : { bytes, contentType };
  }
  return null;
}
