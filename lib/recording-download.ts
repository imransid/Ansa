import "server-only";
import { readStreamWithLimit } from "./read-raw-body";

// Downloads a call recording from a URL that came in a (signed) Vapi webhook.
// The server fetching a URL it was handed is a classic attack ("SSRF": making
// us call internal addresses), so every URL, including every redirect, must be
// https on an allowed host. The URL is never logged.

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

export type DownloadedRecording = { bytes: Buffer; contentType: string };

const MAX_REDIRECTS = 3;

// Says whether a recording URL may be fetched: https, an exact allowed host,
// default port, and no user name or password in it.
export function isAllowedRecordingUrl(rawUrl: string, allowedHosts: string[]): boolean {
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

// Returns the recording, or null if any rule is broken (bad URL or redirect,
// not audio, too big, server error).
export async function downloadRecording(
  rawUrl: string,
  allowedHosts: string[],
  maxBytes: number,
  fetcher: Fetcher,
): Promise<DownloadedRecording | null> {
  let currentUrl = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isAllowedRecordingUrl(currentUrl, allowedHosts)) {
      return null;
    }
    // redirect: "manual", so a redirect to a forbidden host is never requested.
    const response = await fetcher(currentUrl, { redirect: "manual", signal: AbortSignal.timeout(30_000) });
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
    if (!contentType.startsWith("audio/")) {
      return null;
    }
    const bytes = await readStreamWithLimit(response.body, response.headers.get("content-length"), maxBytes);
    return bytes === "too-large" ? null : { bytes, contentType };
  }
  return null;
}
