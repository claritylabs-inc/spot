import type { NextConfig } from "next";

const convexSiteUrl =
  process.env.NEXT_PUBLIC_CONVEX_SITE_URL ??
  process.env.CONVEX_SITE_URL ??
  process.env.NEXT_PUBLIC_CONVEX_URL?.replace(".convex.cloud", ".convex.site");

const appHost = "app.spot.insure";
const appAliasHosts = [
  "spot.claritylabs.inc",
  "app.glass.insure",
  "glass.claritylabs.inc",
];
const legacyAssetRewrites = [
  { source: "/glass-icon.jpg", destination: "/spot-icon.jpg" },
  { source: "/glass-icon.svg", destination: "/spot-icon.svg" },
];

const nextConfig: NextConfig = {
  experimental:
    process.env.CONDUCTOR_IS_LOCAL === "0" &&
    process.env.NODE_ENV === "development"
      ? { turbopackMemoryLimit: 2 * 1024 ** 3 }
      : undefined,
  env: {
    NEXT_PUBLIC_VERCEL_ENV:
      process.env.VERCEL_ENV ?? process.env.NEXT_PUBLIC_VERCEL_ENV ?? "",
  },
  async redirects() {
    return appAliasHosts.map((host) => ({
      source: "/:path*",
      has: [{ type: "host" as const, value: host }],
      destination: `https://${appHost}/:path*`,
      permanent: true,
    }));
  },
  async rewrites() {
    if (!convexSiteUrl) return legacyAssetRewrites;

    return [
      ...legacyAssetRewrites,
      {
        source: "/.well-known/mcp.json",
        destination: `${convexSiteUrl}/.well-known/mcp.json`,
      },
      {
        source: "/.well-known/oauth-protected-resource",
        destination: `${convexSiteUrl}/.well-known/oauth-protected-resource`,
      },
      {
        source: "/.well-known/oauth-authorization-server",
        destination: `${convexSiteUrl}/.well-known/oauth-authorization-server`,
      },
      {
        source: "/oauth/register",
        destination: `${convexSiteUrl}/oauth/register`,
      },
      {
        source: "/oauth/token",
        destination: `${convexSiteUrl}/oauth/token`,
      },
      {
        source: "/oauth/revoke",
        destination: `${convexSiteUrl}/oauth/revoke`,
      },
      {
        source: "/mcp",
        destination: `${convexSiteUrl}/mcp`,
      },
      {
        source: "/mcp/:path*",
        destination: `${convexSiteUrl}/mcp/:path*`,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          {
            key: "Cache-Control",
            value: "no-store, must-revalidate",
          },
          {
            key: "Service-Worker-Allowed",
            value: "/",
          },
        ],
      },
    ];
  },
  transpilePackages: ["@claritylabs/cl-sync"],
  serverExternalPackages: ["canvas"],
  turbopack: {
    root: process.cwd(),
    resolveAlias: {
      "pdfjs-dist": "pdfjs-dist/legacy/build/pdf.mjs",
      "pdfjs-dist/build/pdf.worker.mjs":
        "pdfjs-dist/legacy/build/pdf.worker.mjs",
    },
  },
};

export default nextConfig;
