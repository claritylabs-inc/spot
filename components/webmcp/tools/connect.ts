import { api } from "@/convex/_generated/api";
import { policyRow } from "@/components/webmcp/tools/insurance";
import {
  compact,
  id,
  isoTime,
  requiredText,
  text,
  type ClientToolContext,
  type ToolMap,
} from "@/components/webmcp/tools/helpers";

type ConnectionRow = {
  _id: string;
  kind?: string;
  status?: string;
  label?: string;
  note?: string;
  clientOrg?: { _id: string; name?: string } | null;
  vendorOrg?: { _id: string; name?: string } | null;
  invitationId?: string;
  vendorEmail?: string;
  invitationStatus?: string;
  updatedAt?: number;
};

/**
 * Only the fields the connections table shows. Raw invitation rows also carry
 * token hashes and one-time codes that must never reach an agent.
 */
function connectionRow(row: ConnectionRow) {
  return {
    relationship_id: row.kind === "invitation" ? null : row._id,
    invitation_id: row.invitationId ?? (row.kind === "invitation" ? row._id : null),
    kind: row.kind ?? null,
    status: row.status ?? null,
    invitation_status: row.invitationStatus ?? null,
    label: row.label ?? null,
    note: row.note ?? null,
    client_org: row.clientOrg ? { org_id: row.clientOrg._id, name: row.clientOrg.name ?? null } : null,
    vendor_org: row.vendorOrg ? { org_id: row.vendorOrg._id, name: row.vendorOrg.name ?? null } : null,
    vendor_email: row.vendorEmail ?? null,
    updated_at: isoTime(row.updatedAt),
  };
}

export function connectToolImplementations(ctx: ClientToolContext): ToolMap {
  const { convex, orgId } = ctx;
  return {
    list_vendors: async () => ({
      status: "ok",
      vendors: (await convex.query(api.connectedOrgs.listVendors, { orgId })).map(connectionRow),
    }),
    list_connected_clients: async () => ({
      status: "ok",
      clients: (await convex.query(api.connectedOrgs.listClients, { orgId })).map(connectionRow),
    }),
    list_vendor_compliance: async () => ({
      status: "ok",
      vendors: await convex.query(api.compliance.listVendorCompliance, { clientOrgId: orgId }),
    }),
    list_vendor_policies: async (input) => {
      const policies = await convex.query(api.policies.listForOrg, {
        orgId: id<"organizations">(input, "vendor_org_id"),
        documentType: "policy",
      });
      return { status: "ok", policies: policies.map(policyRow) };
    },
    request_vendor_access: async (input) => {
      const result = await convex.action(
        api.connectedOrgs.requestVendorAccessByEmail,
        compact({
          clientOrgId: orgId,
          vendorEmail: requiredText(input, "vendor_email"),
          relationshipLabel: text(input, "relationship_label"),
          note: text(input, "note"),
        }),
      );
      return { status: result.status, vendor_email: result.email };
    },
    resend_vendor_invitation: async (input) => {
      const result = await convex.action(api.connectedOrgs.resendVendorInvitation, {
        invitationId: id<"connectedOrgInvitations">(input, "invitation_id"),
      });
      return { status: result.status, vendor_email: result.email };
    },
    cancel_vendor_invitation: async (input) => {
      await convex.mutation(api.connectedOrgs.revokeInvitation, {
        invitationId: id<"connectedOrgInvitations">(input, "invitation_id"),
      });
      return { status: "cancelled" };
    },
    approve_connection: async (input) => {
      await convex.mutation(api.connectedOrgs.approve, {
        relationshipId: id<"connectedOrgRelationships">(input, "relationship_id"),
      });
      return { status: "active" };
    },
    revoke_connection: async (input) => {
      await convex.mutation(api.connectedOrgs.revoke, {
        relationshipId: id<"connectedOrgRelationships">(input, "relationship_id"),
      });
      return { status: "revoked" };
    },
  };
}
