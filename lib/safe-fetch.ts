import "server-only";
import { lookup as dnsLookup } from "node:dns/promises";
import type { IncomingHttpHeaders } from "node:http";
import { request as httpsRequest, type RequestOptions } from "node:https";
import { isIP } from "node:net";
import type { Readable } from "node:stream";
import { isPublicAddress } from "./public-address";
import { readTextAnswer } from "./safe-fetch-answer";
import { closeAll, keepTrackOf, noOpenConnections, requestOnce, type OpenConnections } from "./safe-fetch-request";

// Fetches a web page someone typed the address of ("Import a web page", step
// 34), without letting that address reach anything private ("SSRF"): https
// on the default port only, no user name or password, no cookies or
// credentials sent, and only a host whose EVERY address is public
// (lib/public-address.ts). The host is resolved here, once, and the
// connection goes to exactly the address that was checked (the `lookup`
// given to node:https), so a DNS answer that changes in between ("DNS
// rebinding") can't swap in a private one. Every redirect (at most 3) is
// checked the same way. 10 seconds in all, 2 MB at most, text/html or
// text/plain only: once the 10 seconds are up, everything it opened is
// closed and nothing more is opened, even when a DNS answer comes later.
// Never logs: the caller logs the error code.

export type ResolvedAddress = { address: string; family: number };
// Turns a host name into its addresses. Replaced in the checks, which never
// touch the network.
export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;

// The parts of node:https's request() this file uses, so the checks can
// answer with a fake server.
export type HttpsResponse = Readable & { statusCode?: number; headers: IncomingHttpHeaders };
export type HttpsRequestHandle = {
  on(event: "error", listener: (error: Error) => void): unknown;
  end(): unknown;
  destroy(error?: Error): unknown;
};
export type HttpsRequester = (options: RequestOptions, onResponse: (response: HttpsResponse) => void) => HttpsRequestHandle;

export type SafeFetchSettings = {
  resolve: Resolver;
  request: HttpsRequester;
  maxBytes: number;
  timeoutMs: number;
  maxRedirects: number;
};

export type SafeFetchErrorCode =
  | "invalid_url"
  | "not_https"
  | "port_not_allowed"
  | "credentials_in_url"
  | "private_address"
  | "dns_failed"
  | "too_many_redirects"
  | "bad_redirect"
  | "http_status"
  | "wrong_type"
  | "unsupported_encoding"
  | "too_large"
  | "timeout"
  | "network_error";

export type SafeFetchResult =
  | { ok: true; contentType: "text/html" | "text/plain"; text: string }
  | { ok: false; code: SafeFetchErrorCode };

const DEFAULT_SETTINGS: SafeFetchSettings = {
  resolve: resolveWithDns,
  request: httpsRequest,
  maxBytes: 2 * 1024 * 1024,
  timeoutMs: 10_000,
  maxRedirects: 3,
};

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

// The page's text (decoded with the charset its server names, else UTF-8), or
// why not. Whatever is still open when it ends (a request, an answer) is
// closed, and whatever the fetch would open after that is closed at once.
export async function safeFetchText(rawUrl: string, settings: Partial<SafeFetchSettings> = {}): Promise<SafeFetchResult> {
  const options = { ...DEFAULT_SETTINGS, ...settings };
  const connections = noOpenConnections();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<SafeFetchResult>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, code: "timeout" }), options.timeoutMs);
  });
  try {
    return await Promise.race([fetchFollowingRedirects(rawUrl, options, connections), timeout]);
  } finally {
    clearTimeout(timer);
    closeAll(connections);
  }
}

async function fetchFollowingRedirects(rawUrl: string, options: SafeFetchSettings, connections: OpenConnections): Promise<SafeFetchResult> {
  let url = parseHttpsUrl(rawUrl);
  for (let redirects = 0; ; redirects++) {
    if (!(url instanceof URL)) {
      return { ok: false, code: url };
    }
    const addresses = await publicAddressesOf(url.hostname.replace(/^\[|\]$/g, ""), options.resolve);
    // The time limit ended the fetch while the host was being looked up:
    // nobody waits for this answer any more, so no request is sent.
    if (connections.closed) {
      return { ok: false, code: "timeout" };
    }
    if (!Array.isArray(addresses)) {
      return { ok: false, code: addresses };
    }
    let response: HttpsResponse;
    try {
      response = await requestOnce(url, addresses, options.request, connections);
    } catch {
      return { ok: false, code: "network_error" };
    }
    keepTrackOf(connections, response);
    const status = response.statusCode ?? 0;
    if (!REDIRECT_STATUSES.has(status)) {
      return readTextAnswer(response, status, options.maxBytes);
    }
    response.destroy();
    if (redirects >= options.maxRedirects) {
      return { ok: false, code: "too_many_redirects" };
    }
    url = redirectTarget(response.headers.location, url);
  }
}

// The URL if it may be fetched at all, else why not. The host is checked next.
function parseHttpsUrl(rawUrl: string): URL | SafeFetchErrorCode {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return "invalid_url";
  }
  if (url.protocol !== "https:") {
    return "not_https";
  }
  if (url.username !== "" || url.password !== "") {
    return "credentials_in_url";
  }
  // URL leaves the port empty when it is https's own, 443.
  if (url.port !== "") {
    return "port_not_allowed";
  }
  return url.hostname === "" ? "invalid_url" : url;
}

function redirectTarget(location: string | undefined, from: URL): URL | SafeFetchErrorCode {
  if (!location) {
    return "bad_redirect";
  }
  try {
    return parseHttpsUrl(new URL(location, from).toString());
  } catch {
    return "bad_redirect";
  }
}

// Every address of the host, when all of them are public. An address typed
// as the host ("https://10.0.0.1/") is checked as it is: no lookup.
async function publicAddressesOf(host: string, resolve: Resolver): Promise<ResolvedAddress[] | SafeFetchErrorCode> {
  const family = isIP(host);
  let addresses: ResolvedAddress[];
  try {
    addresses = family ? [{ address: host, family }] : await resolve(host);
  } catch {
    return "dns_failed";
  }
  if (addresses.length === 0) {
    return "dns_failed";
  }
  return addresses.every((entry) => isPublicAddress(entry.address)) ? addresses : "private_address";
}

async function resolveWithDns(hostname: string): Promise<ResolvedAddress[]> {
  const results = await dnsLookup(hostname, { all: true, verbatim: true });
  return results.map((result) => ({ address: result.address, family: result.family }));
}
