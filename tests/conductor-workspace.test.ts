// @vitest-environment node

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  consumerAiCredentialNames,
  conductorImageTag,
  conductorPorts,
  conductorLocalRuntimeOverrides,
  repairLocalConvexSelection,
  repoRoot,
  resolveConductorClRouterConfig,
  resolveConductorMapboxAccessToken,
  workspaceSlug,
  withoutCloudConvexSelection,
  withoutConsumerAiCredentials,
} from "../scripts/lib/conductor-workspace.mjs";

describe("Conductor workspace identity", () => {
  it("uses the stable worktree directory when the display name changes", () => {
    const originalWorkspaceName = process.env.CONDUCTOR_WORKSPACE_NAME;
    process.env.CONDUCTOR_WORKSPACE_NAME = "renamed-feature-branch";

    try {
      const expectedSlug = path.basename(repoRoot).toLowerCase();
      expect(workspaceSlug()).toBe(expectedSlug);
      expect(conductorImageTag("extraction-worker")).toBe(
        `spot-extraction-worker:conductor-${expectedSlug}`,
      );
    } finally {
      if (originalWorkspaceName === undefined) {
        delete process.env.CONDUCTOR_WORKSPACE_NAME;
      } else {
        process.env.CONDUCTOR_WORKSPACE_NAME = originalWorkspaceName;
      }
    }
  });

});
describe("Conductor local Convex selection", () => {
  const localConfig = {
    deploymentName: "anonymous-agent",
    ports: { cloud: 55013, site: 55014 },
  };

  it("repairs an existing workspace env file once", () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "spot-conductor-"));
    const configDirectory = path.join(
      workspace,
      ".convex",
      "local",
      "default",
    );

    try {
      mkdirSync(configDirectory, { recursive: true });
      writeFileSync(
        path.join(configDirectory, "config.json"),
        JSON.stringify(localConfig),
      );
      writeFileSync(
        path.join(workspace, ".env.local"),
        "CONVEX_DEPLOYMENT=dev:acoustic-caiman-755\n",
      );

      expect(repairLocalConvexSelection(workspace)).toBe(true);
      expect(repairLocalConvexSelection(workspace)).toBe(false);
      expect(readFileSync(path.join(workspace, ".env.local"), "utf8")).toBe(
        [
          "CONVEX_DEPLOYMENT=anonymous:anonymous-agent",
          "NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:55013",
          "NEXT_PUBLIC_CONVEX_SITE_URL=http://127.0.0.1:55014",
          "",
        ].join("\n"),
      );
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("recovers the workspace port namespace for standalone helper commands", () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "spot-conductor-"));
    const configDirectory = path.join(
      workspace,
      ".convex",
      "local",
      "default",
    );
    const previousPort = process.env.CONDUCTOR_PORT;
    delete process.env.CONDUCTOR_PORT;
    try {
      mkdirSync(configDirectory, { recursive: true });
      writeFileSync(
        path.join(configDirectory, "config.json"),
        JSON.stringify({ ports: { cloud: 55003, site: 55004 } }),
      );

      expect(conductorPorts(workspace)).toEqual({
        web: 55000,
        extraction: 55001,
        imessage: 55002,
        convexCloud: 55003,
        convexSite: 55004,
        slack: 55005,
        operatorImessage: 55006,
      });
    } finally {
      if (previousPort === undefined) delete process.env.CONDUCTOR_PORT;
      else process.env.CONDUCTOR_PORT = previousPort;
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("refreshes every port-sensitive local service URL before the web app starts", () => {
    const previousPort = process.env.CONDUCTOR_PORT;
    process.env.CONDUCTOR_PORT = "55000";
    try {
      expect(conductorLocalRuntimeOverrides()).toEqual({
        APP_SITE_URL: "http://localhost:55000",
        AUTH_LINK_SITE_URL: "http://localhost:55000",
        CLIENT_PORTAL_URL: "http://localhost:55000",
        SITE_URL: "http://localhost:55000",
        EXTRACTION_WORKER_URL: "http://127.0.0.1:55001",
        IMESSAGE_WORKER_URL: "http://127.0.0.1:55002",
        SLACK_WORKER_URL: "http://127.0.0.1:55005",
        OPERATOR_IMESSAGE_WORKER_URL: "http://127.0.0.1:55006",
      });
    } finally {
      if (previousPort === undefined) delete process.env.CONDUCTOR_PORT;
      else process.env.CONDUCTOR_PORT = previousPort;
    }
  });
});
describe("Conductor Convex bootstrap", () => {
  it("filters provider credentials from copied and imported environments", () => {
    const filtered = withoutConsumerAiCredentials(
      [
        "OPENAI_API_KEY=openai-secret",
        "PARALLEL_API_KEY=parallel-secret",
        "AI_GATEWAY_API_KEY=retired-secret",
        "MOONSHOTAI_API_KEY=retired-moonshot-secret",
        "CL_ROUTER_SECRET=router-inference-secret",
        "AUTH_RESEND_KEY=email-integration-secret",
        "",
      ].join("\n"),
    );

    expect(filtered).toBe(
      [
        "CL_ROUTER_SECRET=router-inference-secret",
        "AUTH_RESEND_KEY=email-integration-secret",
        "",
      ].join("\n"),
    );
    expect(consumerAiCredentialNames).toContain("MOONSHOT_API_KEY");
    expect(consumerAiCredentialNames).toContain("VERCEL_AI_GATEWAY_API_KEY");
  });

  it("removes credentials retained by an older local Convex setup", () => {
    const setupSource = readFileSync(
      path.join(repoRoot, "scripts/setup-conductor-workspace.mjs"),
      "utf8",
    );
    expect(setupSource).toContain("removeConsumerAiCredentials(convex);");
    expect(setupSource).toContain('run(convex, ["env", "remove", name])');
  });

  it("passes the native-local HTTP actions URL to the extraction worker", () => {
    const setupSource = readFileSync(
      path.join(repoRoot, "scripts/setup-conductor-workspace.mjs"),
      "utf8",
    );
    expect(setupSource).toMatch(
      /writeRuntimeEnv\("extraction-worker\.env", \{\s+CONVEX_URL: localUrls\.cloud,\s+CONVEX_SITE_URL: localUrls\.site,/,
    );
  });

  it("requires only router URL and inference secret for every AI task", () => {
    expect(
      resolveConductorClRouterConfig(
        {
          url: " https://router.example.test ",
          secret: " router-secret ",
          timeoutMs: "60000",
        },
        { required: true },
      ),
    ).toEqual({
      url: "https://router.example.test",
      secret: "router-secret",
      timeoutMs: "60000",
      tenantId: "glass",
    });
  });

  it("does not treat a legacy task gate as router configuration", () => {
    expect(() =>
      resolveConductorClRouterConfig(
        { tasks: "*", url: "", secret: "" },
        { required: true },
      ),
    ).toThrow("CL_ROUTER_URL, CL_ROUTER_SECRET");
  });

  it("falls back to the Cloud Computer Mapbox token when the copied env omits it", () => {
    expect(
      resolveConductorMapboxAccessToken(new Map(), {
        NEXT_PUBLIC_MAPBOX_TOKEN: " cloud-mapbox-token ",
      }),
    ).toBe("cloud-mapbox-token");
  });
  it("removes cloud selection and credentials from local Convex processes", () => {
    const environment = {
      CONVEX_DEPLOYMENT: "dev:acoustic-caiman-755",
      CONVEX_DEPLOY_KEY: "dev:acoustic-caiman-755|secret-token-material",
      CONDUCTOR_CONVEX_SOURCE_DEPLOY_KEY:
        "dev:acoustic-caiman-755|dedicated-secret-token-material",
      CONDUCTOR_CONVEX_SOURCE_DEPLOYMENT: "dev:acoustic-caiman-755",
      CONVEX_SELF_HOSTED_URL: "https://wrong.example.test",
      NEXT_PUBLIC_CONVEX_URL: "https://wrong.example.test",
      UNRELATED_VALUE: "preserved",
    };

    expect(withoutCloudConvexSelection(environment)).toEqual({
      UNRELATED_VALUE: "preserved",
    });
    expect(environment.CONVEX_DEPLOYMENT).toBe("dev:acoustic-caiman-755");
  });
});
