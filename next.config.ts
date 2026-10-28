import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // No "X-Powered-By: Next.js" on every answer: it only tells strangers what
  // to probe for.
  poweredByHeader: false,
  experimental: {
    serverActions: {
      // Document uploads (step 16) are capped at 4 MB (lib/document-files.ts),
      // under Vercel's 4.5 MB request limit, and the upload form refuses a
      // bigger file before sending it. Everything else stays small.
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
