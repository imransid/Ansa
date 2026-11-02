import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { env } from "@/lib/env";

// The public website's pages, for search engines.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Read at request time, not at build time: the links must use the running
  // server's APP_URL (see app/robots.ts).
  await connection();
  return ["", "/pricing", "/privacy", "/terms"].map((path) => ({ url: `${env.APP_URL}${path}` }));
}
