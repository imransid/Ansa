import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // No "X-Powered-By: Next.js" on every answer: it only tells strangers what
  // to probe for.
  poweredByHeader: false,
  // The development server's on-screen route badge sits over the sidebar's
  // foot (Account) and shows in every demo; compile and runtime errors still
  // show without it.
  devIndicators: false,
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
      // The practice phone (step 55) records the caller's voice: on the
      // development server only, its one page may use the microphone (this
      // site's own, no other). The rule above still holds everywhere else,
      // and on that page in production (the practice phone is off there).
      // Next applies the later rule for the same header.
      ...(process.env.NODE_ENV === "production"
        ? []
        : [
            {
              source: "/settings/channels/practice-call",
              headers: [{ key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" }],
            },
          ]),
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
