import "server-only";
import { downloadFromAllowedHost, isAllowedHostUrl, type DownloadedFile, type Fetcher } from "./allowed-host-download";

// Downloads a call recording from a URL that came in a (signed) Vapi webhook,
// through the same https-on-an-allowed-host rules as every file the server
// fetches because a service said so (lib/allowed-host-download.ts says why).
// The URL is never logged.

export type { Fetcher };

export type DownloadedRecording = DownloadedFile;

// For the whole copy, redirects and body together: a 100 MB recording
// arrives well within it.
const RECORDING_DOWNLOAD_TIMEOUT_MS = 60_000;

// Says whether a recording URL may be fetched: https, an exact allowed host,
// default port, and no user name or password in it.
export function isAllowedRecordingUrl(rawUrl: string, allowedHosts: string[]): boolean {
  return isAllowedHostUrl(rawUrl, allowedHosts);
}

// Returns the recording, or null if any rule is broken (bad URL or redirect,
// not audio, too big, server error).
export async function downloadRecording(rawUrl: string, allowedHosts: string[], maxBytes: number, fetcher: Fetcher): Promise<DownloadedRecording | null> {
  const downloaded = await downloadFromAllowedHost(rawUrl, {
    allowedHosts,
    maxBytes,
    acceptsType: (contentType) => contentType.startsWith("audio/"),
    timeoutMs: RECORDING_DOWNLOAD_TIMEOUT_MS,
    fetcher,
  });
  // A recording too big to keep is not kept, like any other refused one.
  return downloaded === "too-large" ? null : downloaded;
}
