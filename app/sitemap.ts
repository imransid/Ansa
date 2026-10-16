import type { MetadataRoute } from "next";
import { env } from "@/lib/env";

export default function sitemap(): MetadataRoute.Sitemap {
  return ["", "/pricing", "/privacy", "/terms"].map((path) => ({ url: `${env.BETTER_AUTH_URL}${path}` }));
}
