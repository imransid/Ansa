import "server-only";
import { isIP, type LookupFunction } from "node:net";
import type { HttpsRequester, HttpsResponse, ResolvedAddress } from "./safe-fetch";

// One request of lib/safe-fetch.ts, to exactly the addresses it checked, and
// the list of what one fetch has open so all of it is closed when it ends.

type Closable = { destroy(): unknown };

// What one fetch has opened (requests, answers). WHY "closed" stays set once
// the fetch ended: the time limit can end it while a DNS answer is still on
// its way (a lookup can't be stopped), and anything opened after that would
// stay open with no time limit, read by nobody.
export type OpenConnections = { closed: boolean; open: Set<Closable> };

export function noOpenConnections(): OpenConnections {
  return { closed: false, open: new Set() };
}

// Remembers something the fetch opened, or closes it at once when the fetch
// has already ended.
export function keepTrackOf(connections: OpenConnections, thing: Closable): void {
  if (connections.closed) {
    thing.destroy();
    return;
  }
  connections.open.add(thing);
}

// Closes everything the fetch opened, and anything it opens from now on.
export function closeAll(connections: OpenConnections): void {
  connections.closed = true;
  for (const thing of connections.open) {
    thing.destroy();
  }
}

// Sends one GET to the URL's host, connecting only to the checked addresses.
export function requestOnce(url: URL, addresses: ResolvedAddress[], request: HttpsRequester, connections: OpenConnections): Promise<HttpsResponse> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  return new Promise((resolve, reject) => {
    const handle = request(
      {
        method: "GET",
        hostname: host,
        port: 443,
        path: `${url.pathname}${url.search}`,
        // Plain text back, and nothing about us: no cookie, no authorization.
        headers: { accept: "text/html, text/plain;q=0.9", "accept-encoding": "identity", "user-agent": "ansa-knowledge-import" },
        // A connection of its own (never a kept-alive one to another address).
        agent: false,
        lookup: pinnedLookup(addresses),
        // TLS checks the certificate against the host name. Never an IP address here.
        servername: isIP(host) ? undefined : host,
      },
      resolve,
    );
    handle.on("error", reject);
    keepTrackOf(connections, handle);
    handle.end();
  });
}

// Answers node's own lookup with the addresses already checked, and only those.
function pinnedLookup(addresses: ResolvedAddress[]): LookupFunction {
  return (_hostname, lookupOptions, callback) => {
    const wanted = lookupOptions.family === 4 || lookupOptions.family === 6 ? addresses.filter((entry) => entry.family === lookupOptions.family) : addresses;
    if (wanted.length === 0) {
      callback(new Error("No checked address of that family"), "", 0);
      return;
    }
    if (lookupOptions.all) {
      callback(null, wanted.map((entry) => ({ address: entry.address, family: entry.family })));
      return;
    }
    callback(null, wanted[0].address, wanted[0].family);
  };
}
