import { describe, expect, it } from "vitest";
import {
  buildSpotAppTools,
  filterSpotAppCatalog,
  getSpotWorkspaceReadCall,
  parseSpotAppInput,
  SPOT_APP_RESOURCE_URI,
} from "../convex/lib/chatgptMcp";

describe("Spot ChatGPT transport isolation", () => {
  it("accepts bounded organization cursors and broker profile navigation", () => {
    expect(parseSpotAppInput("read_spot_workspace", { view: "profile", organizationCursor: "cursor-one" })).toEqual({ view: "profile", organizationCursor: "cursor-one" });
    expect(parseSpotAppInput("read_spot_workspace", { view: "team" })).toEqual({ view: "team" });
    expect(() => parseSpotAppInput("read_spot_workspace", { organizationCursor: "x".repeat(8193) })).toThrow();
  });
  it("allows operator mailbox reads without selecting a client", () => {
    expect(getSpotWorkspaceReadCall("operator", "mailbox", undefined, undefined)).toEqual({ name: "list_company_mailboxes", arguments: {} });
  });
  it("accepts empty global/thread entrypoints without granting write access", () => {
    expect(parseSpotAppInput("open_spot_workspace", {})).toEqual({ view: "policies" });
    expect(buildSpotAppTools().every((tool) => tool.annotations.readOnlyHint)).toBe(true);
    expect(buildSpotAppTools()[0]._meta.ui.resourceUri).toBe(SPOT_APP_RESOURCE_URI);
  });

  it("rejects injected arguments, invalid views and unbounded file references", () => {
    for (const input of [{ view: "private.md" }, { canWrite: true }, { view: "policies", principalKind: "operator" }]) {
      expect(() => parseSpotAppInput("read_spot_workspace", input)).toThrow();
    }
    expect(() => parseSpotAppInput("open_spot_file", { file: { name: "../secret.pdf", resourceUri: "host-resource://file" } })).toThrow();
    expect(() => parseSpotAppInput("open_spot_file", { file: { name: "document.pdf", resourceUri: " " } })).toThrow();
    expect(() => parseSpotAppInput("open_spot_file", { file: { name: "document.pdf", resourceUri: "x".repeat(8193) } })).toThrow();
  });

  it("keeps opaque host references out of backend fetch operations", () => {
    expect(parseSpotAppInput("open_spot_file", { file: { name: "requirements.pdf", resourceUri: "host-resource://opaque" } })).toEqual({
      view: "files", file: { name: "requirements.pdf", resourceUri: "host-resource://opaque" },
    });
  });

  it("does not expose client tools to a broker or writes to read-only connections", () => {
    const catalog = [
      { name: "get_policy", annotations: { readOnlyHint: true } },
      { name: "generate_coi", annotations: { readOnlyHint: false } },
      { name: "ambiguous" },
    ];
    expect(filterSpotAppCatalog(catalog, "broker", true)).toEqual([]);
    expect(filterSpotAppCatalog(catalog, "client", false).map((tool) => tool.name)).toEqual(["get_policy"]);
  });

  it("uses only authoritative read tools for navigation, never a workflow start", () => {
    expect(getSpotWorkspaceReadCall("client", "policies", "policy-one", "org-one")).toEqual({ name: "get_policy", arguments: { id: "policy-one" } });
    expect(getSpotWorkspaceReadCall("operator", "policies", undefined, "org-one")).toEqual({ name: "list_policies", arguments: { orgId: "org-one" } });
    expect(getSpotWorkspaceReadCall("operator", "activity", "run-one", "org-one")).toEqual({ name: "get_operator_run", arguments: { run_id: "run-one" } });
    expect(getSpotWorkspaceReadCall("client", "proposals", "proposal-one", "org-one")).toBeNull();
    expect(getSpotWorkspaceReadCall("broker", "policies", undefined, "org-one")).toBeNull();
    expect(getSpotWorkspaceReadCall("operator", "policies", undefined, undefined)).toBeNull();
  });
});
