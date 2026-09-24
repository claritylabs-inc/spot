import { execFile } from "child_process";
import { createServer, type Server, type ServerResponse } from "http";
import type { AddressInfo } from "net";
import { join } from "path";
import { promisify } from "util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const execFileAsync = promisify(execFile);

let healthServer: Server;
let healthBaseUrl: string;

function writeJson(res: ServerResponse, payload: unknown) {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

function convexHealth(
  options: {
    operatorImessageContactPhoneConfigured?: boolean;
    operatorImessageEnabled?: boolean;
    operatorSlackEnabled?: boolean;
    operatorSlackMissingHostScopes?: string[];
    operatorAgentModelConfigured?: boolean;
  } = {},
) {
  const operatorImessageContactPhoneConfigured =
    options.operatorImessageContactPhoneConfigured ?? true;
  const operatorImessageEnabled = options.operatorImessageEnabled ?? true;
  const operatorSlackEnabled = options.operatorSlackEnabled ?? true;
  const operatorAgentModelConfigured =
    options.operatorAgentModelConfigured ?? true;
  return {
    ok: true,
    spotEnv: "production",
    emailDeliveryMode: "live",
    slack: {
      enabled: true,
      mode: "slack",
    },
    operatorSlack: {
      enabled: operatorSlackEnabled,
      hostTeamConfigured: true,
      missingHostScopes: options.operatorSlackMissingHostScopes ?? [],
    },
    operatorAgent: {
      modelConfigured: operatorAgentModelConfigured,
    },
    operatorImessage: {
      inboundEnabled: operatorImessageEnabled,
      contactPhoneConfigured: operatorImessageContactPhoneConfigured,
      workerUrlConfigured: true,
      workerSecretConfigured: true,
    },
  };
}

function imessageHealth() {
  return {
    ok: true,
    service: "spot-imessage-worker",
    spotEnv: "production",
    channelRole: "customer",
    transport: "imessage",
    imessageEnabled: true,
    convexSiteConfigured: true,
    workerSecretConfigured: true,
    photonConfigured: true,
    httpPorts: [3001],
  };
}

function operatorImessageHealth() {
  return {
    ...imessageHealth(),
    channelRole: "operator",
    httpPorts: [],
  };
}

function clRouterHealth() {
  return {
    status: "ok",
    environment: "production",
    database: true,
    frozen: true,
    policyVersion: "policy-v1",
  };
}

function slackWorkerHealth() {
  return {
    ok: true,
    service: "spot-slack-worker",
    spotEnv: "production",
    mode: "slack",
    workerSecretConfigured: true,
    tokenBrokerConfigured: true,
    clarityTeamConfigured: true,
    outboundEnabled: true,
    actorResolutionEnabled: true,
    connectProvisioningEnabled: true,
    channelInventoryEnabled: true,
    publicChannelJoinEnabled: true,
    blockKitEnabled: true,
    messageUpdatesEnabled: true,
    reactionsEnabled: true,
    agentStatusEnabled: true,
    streamingEnabled: true,
    interactivityResponsesEnabled: true,
    feedbackModalsEnabled: true,
    reconciliationEnabled: true,
  };
}

async function runAgentHealth(convexPath: string, clRouterPath = "/cl-router") {
  return execFileAsync(
    process.execPath,
    ["scripts/check-agent-deployment-health.mjs", "--env=production"],
    {
      cwd: root,
      env: {
        ...process.env,
        AGENT_HEALTH_ATTEMPTS: "1",
        AGENT_HEALTH_RETRY_DELAY_MS: "1",
        SPOT_CONVEX_AGENT_HEALTH_URL: `${healthBaseUrl}${convexPath}`,
        SPOT_IMESSAGE_WORKER_HEALTH_URL: `${healthBaseUrl}/imessage`,
        SPOT_PRODUCTION_OPERATOR_IMESSAGE_WORKER_HEALTH_URL: `${healthBaseUrl}/operator-imessage`,
        SPOT_PRODUCTION_SLACK_WORKER_HEALTH_URL: `${healthBaseUrl}/slack-worker`,
        SPOT_PRODUCTION_CL_ROUTER_HEALTH_URL: `${healthBaseUrl}${clRouterPath}`,
      },
      timeout: 10_000,
    },
  );
}

beforeAll(async () => {
  healthServer = createServer((req, res) => {
    if (req.url === "/convex-aligned") return writeJson(res, convexHealth());
    if (req.url === "/convex-operator-slack-disabled")
      return writeJson(res, convexHealth({ operatorSlackEnabled: false }));
    if (req.url === "/convex-operator-slack-missing-scopes")
      return writeJson(
        res,
        convexHealth({
          operatorSlackMissingHostScopes: ["reactions:write"],
        }),
      );
    if (req.url === "/convex-operator-imessage-disabled")
      return writeJson(res, convexHealth({ operatorImessageEnabled: false }));
    if (req.url === "/convex-operator-imessage-number-missing")
      return writeJson(
        res,
        convexHealth({
          operatorImessageContactPhoneConfigured: false,
        }),
      );
    if (req.url === "/convex-operator-model-missing")
      return writeJson(
        res,
        convexHealth({
          operatorAgentModelConfigured: false,
        }),
      );
    if (req.url === "/imessage") return writeJson(res, imessageHealth());
    if (req.url === "/operator-imessage")
      return writeJson(res, operatorImessageHealth());
    if (req.url === "/slack-worker") return writeJson(res, slackWorkerHealth());
    if (req.url === "/cl-router") return writeJson(res, clRouterHealth());
    if (req.url === "/cl-router-unfrozen") {
      return writeJson(res, { ...clRouterHealth(), frozen: false });
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) =>
    healthServer.listen(0, "127.0.0.1", resolve),
  );
  const address = healthServer.address() as AddressInfo;
  healthBaseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    healthServer.close((error) => (error ? reject(error) : resolve()));
  });
});

describe("agent deployment safeguards", () => {
  it.each([
    ["model route", "/convex-operator-model-missing", "operatorAgent.modelConfigured"],
    ["Slack", "/convex-operator-slack-disabled", "operatorSlack.enabled"],
    [
      "Slack host scopes",
      "/convex-operator-slack-missing-scopes",
      "missing scopes: reactions:write",
    ],
    [
      "iMessage",
      "/convex-operator-imessage-disabled",
      "operatorImessage.inboundEnabled",
    ],
    [
      "iMessage without a contact number",
      "/convex-operator-imessage-number-missing",
      "operatorImessage.contactPhoneConfigured",
    ],
  ])(
    "blocks production for invalid operator %s configuration",
    async (_channel, path, expectedError) => {
      await expect(runAgentHealth(path)).rejects.toMatchObject({
        stderr: expect.stringContaining(expectedError),
      });
    },
  );

  it("accepts deployment health when Convex and worker health agree", async () => {
    const result = await runAgentHealth("/convex-aligned");

    expect(result.stdout).toContain(
      "[agent-health] production deployment health passed",
    );
  });
});
