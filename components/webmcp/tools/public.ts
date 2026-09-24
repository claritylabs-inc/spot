import type { ConvexReactClient } from "convex/react";
import { api } from "@/convex/_generated/api";
import { webMcpError } from "@/lib/webmcp/runtime";
import type { ToolMap } from "@/components/webmcp/tools/helpers";

/** Last path segment of a token page, for example /share/email/:token. */
export function pageToken(pathname: string): string | null {
  const segments = pathname.split("/").filter(Boolean);
  return segments.length >= 3 ? decodeURIComponent(segments[segments.length - 1]!) : null;
}

type Invitation = {
  status?: string;
  vendorEmail?: string;
  relationshipLabel?: string;
  note?: string;
  expiresAt?: number;
  clientOrg?: { name?: string } | null;
  vendorOrg?: { name?: string } | null;
};

/**
 * Tools for public token pages. Authorization is the page token itself, the
 * same as the visible page; nothing here reads or writes session-only data.
 */
export function publicToolImplementations(
  convex: ConvexReactClient,
  pathname: string,
): ToolMap {
  const token = pageToken(pathname);
  const requireToken = () => {
    if (!token) throw new Error("This page has no share token.");
    return token;
  };
  return {
    get_vendor_invitation: async () => {
      const invitation = (await convex.action(api.connectedOrgs.getInvitationByToken, {
        token: requireToken(),
      })) as Invitation | null;
      if (!invitation) return webMcpError("Invitation not found.");
      return {
        status: "ok",
        invitation: {
          status: invitation.status ?? null,
          client: invitation.clientOrg?.name ?? null,
          vendor: invitation.vendorOrg?.name ?? null,
          vendor_email: invitation.vendorEmail ?? null,
          label: invitation.relationshipLabel ?? null,
          note: invitation.note ?? null,
        },
      };
    },
    accept_vendor_invitation: async () => {
      const result = await convex.mutation(api.connectedOrgs.acceptInvitation, {
        token: requireToken(),
      });
      return {
        status: "accepted",
        relationship_id: result.relationshipId,
        vendor_org_id: result.vendorOrgId,
        next_url: "/onboarding",
      };
    },
    get_shared_packet: async () => {
      const packet = await convex.query(api.procurementPacket.getByToken, { token: requireToken() });
      if (!packet) return webMcpError("This packet link is not available.");
      return { status: "ok", packet };
    },
    get_shared_email_draft: async () => {
      const draft = await convex.query(api.emailDraftReviewLinks.getByToken, {
        token: requireToken(),
      });
      if (!draft) return webMcpError("This email link is not available.");
      return { status: "ok", draft };
    },
    send_shared_email_draft: async () => {
      const result = await convex.action(api.actions.emailDraftReview.send, {
        token: requireToken(),
      });
      return { status: result.status };
    },
    get_shared_card: async () => {
      const card = await convex.query(api.appCardLinks.getByToken, { token: requireToken() });
      if (!card) return webMcpError("This card link is not available.");
      return { status: "ok", card };
    },
  };
}
