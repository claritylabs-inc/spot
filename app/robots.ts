import type { MetadataRoute } from "next";

// Crawling stays allowed on purpose. Every response carries
// `X-Robots-Tag: noindex, nofollow` (see next.config.ts), and Google can only
// drop already-crawled URLs if it can still fetch them and see that header.
// `Disallow: /` would leave them "Indexed, though blocked by robots.txt".
// Replace the rule with `disallow: "/"` once Search Console shows the app's
// URLs have dropped out of the index.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
  };
}
