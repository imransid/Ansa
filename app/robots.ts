import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { env } from "@/lib/env";
import { SIGNED_IN_SECTIONS } from "@/lib/login-redirect";

// Search engines may index the public website only, never the app. The app's
// sections come from the same list proxy.ts guards, so a new one is never
// left out (/emails was).
export default async function robots(): Promise<MetadataRoute.Robots> {
  // Without this, Next.js would write this file once at build time, with the
  // BETTER_AUTH_URL the build had, and serve it forever. The running
  // server's own setting must be the one search engines get.
  await connection();
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/pricing", "/privacy", "/terms"],
      disallow: [
        "/api/",
        ...SIGNED_IN_SECTIONS,
        "/invite",
        "/verify-email",
        "/check-email",
        "/forgot-password",
        "/reset-password",
      ],
    },
    sitemap: `${env.BETTER_AUTH_URL}/sitemap.xml`,
  };
}
