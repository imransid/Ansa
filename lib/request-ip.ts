import "server-only";
import { headers } from "next/headers";

// Returns the caller's IP address, used as a rate limit key.
export async function getClientIp(): Promise<string> {
  const headerList = await headers();

  // x-forwarded-for looks like "client, proxy1, proxy2". The first entry is
  // the original caller. This header is only trustworthy when the hosting
  // platform overwrites it (Vercel and Cloudflare do). Revisit when we pick hosting.
  const forwardedFor = headerList.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0].trim();
  }

  return headerList.get("x-real-ip") ?? "unknown";
}
