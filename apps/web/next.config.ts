import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Loaded with Node's own import at build time, so it finds its markdown files on disk.
  serverExternalPackages: ["@repo/content"],
  async rewrites() {
    // The browser only ever talks to this origin; Next forwards /api/* to the API server-side, so the
    // API's cookies are first-party here. API_ORIGIN is server-only (no NEXT_PUBLIC_ prefix).
    if (!process.env.API_ORIGIN) return [];
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.API_ORIGIN}/:path*`,
      },
    ];
  },
};

export default nextConfig;
