#!/usr/bin/env node
import { Command } from "commander";
import { SpotApi } from "./api.js";
import { loginWithBrowser } from "./auth.js";
import { loadConfig, saveConfig } from "./config.js";
import { print } from "./output.js";
import { OutputFormat } from "./types.js";

const program = new Command();
program.name("spot").description("Spot CLI").version("0.1.1");
program.option("--json", "output JSON");

function getFormat(options: { json?: boolean }): OutputFormat {
  return options.json ? "json" : "table";
}

program
  .command("auth:login")
  .description("Authenticate with Spot")
  .action(async () => {
    const config = await loadConfig();
    const next = await loginWithBrowser(config);
    await saveConfig({ ...config, ...next });
    console.log("Login successful");
  });

program
  .command("auth:logout")
  .description("Clear local auth state")
  .action(async () => {
    const config = await loadConfig();
    await saveConfig({
      ...config,
      accessToken: undefined,
      refreshToken: undefined,
      expiresAt: undefined,
      orgId: undefined,
    });
    console.log("Logged out");
  });

program
  .command("auth:whoami")
  .option("--set-org <orgId>", "persist default org id")
  .action(async (options) => {
    const config = await loadConfig();
    if (options.setOrg) {
      await saveConfig({ ...config, orgId: options.setOrg });
      console.log(`Default org set to ${options.setOrg}`);
      return;
    }
    const api = new SpotApi(config);
    const me = await api.me();
    print(me, getFormat(program.opts()));
  });

program
  .command("me")
  .action(async () =>
    print(
      await new SpotApi(await loadConfig()).me(),
      getFormat(program.opts()),
    ),
  );
program
  .command("org")
  .action(async () =>
    print(
      await new SpotApi(await loadConfig()).org(),
      getFormat(program.opts()),
    ),
  );
program
  .command("policies:list")
  .option("--limit <n>", "page size", "25")
  .action(async (opts) => {
    const res = await new SpotApi(await loadConfig()).policies(
      Number(opts.limit),
    );
    print(res.data, getFormat(program.opts()));
  });
program
  .command("policies:get <id>")
  .action(async (id) =>
    print(
      await new SpotApi(await loadConfig()).policy(id),
      getFormat(program.opts()),
    ),
  );
program
  .command("notifications:list")
  .option("--limit <n>", "page size", "25")
  .action(async (opts) => {
    const res = await new SpotApi(await loadConfig()).notifications(
      Number(opts.limit),
    );
    print(res.data, getFormat(program.opts()));
  });
program
  .command("query:ask <message>")
  .option("--thread-id <threadId>", "continue an existing thread")
  .action(async (message, opts) => {
    const res = await new SpotApi(await loadConfig()).askSpot(
      message,
      opts.threadId,
    );
    print(res, getFormat(program.opts()));
  });

program
  .command("policies:create")
  .requiredOption("--carrier <carrier>")
  .requiredOption("--policy-number <policyNumber>")
  .requiredOption("--insured-name <insuredName>")
  .requiredOption("--effective-date <effectiveDate>")
  .requiredOption("--expiration-date <expirationDate>")
  .option(
    "--line-of-business <lineOfBusiness>",
    "repeatable ACORD LOB code or label",
    (v, prev: string[] = []) => [...prev, v],
    [],
  )
  .option(
    "--policy-type <policyType>",
    "deprecated alias for --line-of-business",
    (v, prev: string[] = []) => [...prev, v],
    [],
  )
  .action(async (opts) => {
    const linesOfBusiness = [
      ...(opts.lineOfBusiness ?? []),
      ...(opts.policyType ?? []),
    ];
    const res = await new SpotApi(await loadConfig()).createPolicyDraft({
      carrier: opts.carrier,
      policyNumber: opts.policyNumber,
      insuredName: opts.insuredName,
      effectiveDate: opts.effectiveDate,
      expirationDate: opts.expirationDate,
      linesOfBusiness,
    });
    print(res, getFormat(program.opts()));
  });

program
  .command("policies:upload <filePath>")
  .description("Trigger the policy upload/extraction pipeline via the agent")
  .action(async (filePath) => {
    const res = await new SpotApi(await loadConfig()).runUploadPipeline(
      filePath,
    );
    print(res, getFormat(program.opts()));
  });

program
  .command("coi:generate")
  .requiredOption("--policy-id <policyId>")
  .requiredOption("--holder-name <holderName>")
  .option("--holder-contact-name <holderContactName>")
  .option("--holder-email <holderEmail>")
  .option("--holder-phone <holderPhone>")
  .option("--holder-address <holderAddress>")
  .option(
    "--reissue",
    "force a new certificate version for this holder/current policy version",
  )
  .action(async (opts) => {
    const res = await new SpotApi(await loadConfig()).generateCoi(
      opts.policyId,
      opts.holderName,
      opts.holderAddress,
      Boolean(opts.reissue),
      opts.holderEmail,
      opts.holderPhone,
      opts.holderContactName,
    );
    print(res, getFormat(program.opts()));
  });

program
  .command("coi:holders")
  .option("--query <query>")
  .action(async (opts) => {
    const res = await new SpotApi(await loadConfig()).certificateHolders(
      opts.query,
    );
    print(res.data, getFormat(program.opts()));
  });

program.command("policies:versions <policyId>").action(async (policyId) => {
  const res = await new SpotApi(await loadConfig()).policyVersions(policyId);
  print(res.data, getFormat(program.opts()));
});

program.command("coi:versions <policyId>").action(async (policyId) => {
  const res = await new SpotApi(await loadConfig()).certificateVersions(
    policyId,
  );
  print(res.data, getFormat(program.opts()));
});

program.parseAsync().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exitCode = 1;
});
