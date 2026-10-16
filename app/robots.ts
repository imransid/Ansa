import type { MetadataRoute } from "next";
import { env } from "@/lib/env";

// Search engines may index the public website only, never the app.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/pricing", "/privacy", "/terms"],
      disallow: ["/api/", "/dashboard", "/calls", "/tickets", "/team", "/setup", "/billing", "/invite", "/verify-email", "/check-email"],
    },
    sitemap: `${env.BETTER_AUTH_URL}/sitemap.xml`,
  };
}
