import { SPOT_BLUE, SPOT_MARK_PATH } from "../../lib/spot-mark";

// The Convex site has no static file server, so it composes the MCP fallback
// icon from the same geometry constants as the browser and exported assets.
export const SPOT_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 65 65" width="65" height="65" fill="none">
  <circle cx="32.5" cy="32.5" r="31" fill="none" stroke="${SPOT_BLUE}" stroke-width="1.25"/>
  <path d="${SPOT_MARK_PATH}" fill="${SPOT_BLUE}"/>
</svg>
`;

export function spotIconResponse(): Response {
  return new Response(SPOT_ICON_SVG, {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=86400",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
