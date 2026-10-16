import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    serverActions: {
      // Document uploads (step 16) are capped at 4 MB in services/documents.ts,
      // under Vercel's 4.5 MB request limit. Everything else stays small.
      bodySizeLimit: "5mb",
    },
  },
  // Sent with every page and API answer. HSTS is ignored on plain-http localhost.
  headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Never let another site show our pages in a frame (clickjacking).
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000" },
        ],
      },
    ];
  },
  // No landing page yet. The dashboard sends logged-out visitors to /login.
  // permanent: false (307) so browsers don't cache it; we'll want / back for a landing page.
  redirects() {
    return [{ source: "/", destination: "/dashboard", permanent: false }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
