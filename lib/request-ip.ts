import "server-only";
import { headers } from "next/headers";

// Returns the caller's IP address, used as a rate limit key.
// For pages and server actions, where Next.js provides the request headers.
export async function getClientIp(): Promise<string> {
  return getClientIpFromHeaders(await headers());
}

// Same, for route handlers that already have the request's headers.
export function getClientIpFromHeaders(headerList: Pick<Headers, "get">): string {
  // x-forwarded-for looks like "client, proxy1, proxy2". The first entry is
  // the original caller. This header is only trustworthy when the hosting
  // platform overwrites it (Vercel and Cloudflare do; see docs/going-live.md).
  const forwardedFor = headerList.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0].trim();
  }

  return headerList.get("x-real-ip") ?? "unknown";
}
