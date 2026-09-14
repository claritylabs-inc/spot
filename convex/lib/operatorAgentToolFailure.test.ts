import { describe, expect, test } from "vitest";

import { NoWriteInputError } from "./noWriteInputError";
import {
  executionOperatorToolFailure,
  isRecoverableOperatorToolFailure,
  preflightOperatorToolFailure,
} from "./operatorAgentToolFailure";

describe("operator tool failure classification", () => {
  test("makes preflight and explicit no-write validation failures correctable", () => {
    const preflight = preflightOperatorToolFailure(
      "update_broker_network_profile",
      new Error("Broker organization not found"),
    );
    expect(preflight).toMatchObject({
      status: "failed",
      failure: {
        phase: "preflight",
        recoverable: true,
        writeState: "not_started",
      },
    });
    expect(preflight.failure.guidance).toContain("no write started");

    const execution = executionOperatorToolFailure(
      "create_procurement_file_item",
      new NoWriteInputError(
        "missing_client_file",
        "A visible procurement item must reference a client file",
      ),
    );
    expect(execution).toMatchObject({
      status: "failed",
      failure: {
        code: "missing_client_file",
        phase: "execution",
        recoverable: true,
        writeState: "not_started",
      },
    });
    expect(execution.failure.guidance).toContain("fresh confirmation");
    expect(isRecoverableOperatorToolFailure(execution)).toBe(true);
  });

  test("classifies ordinary execution and transport errors as outcome unknown", () => {
    for (const error of [
      new Error("connection reset"),
      "remote action failed",
    ]) {
      const failure = executionOperatorToolFailure(
        "update_broker_network_profile",
        error,
      );
      expect(failure).toMatchObject({
        status: "failed",
        failure: {
          code: "execution_outcome_unknown",
          phase: "execution",
          recoverable: false,
          writeState: "unknown",
        },
      });
      expect(failure.failure.guidance).toContain("Do not replay");
      expect(isRecoverableOperatorToolFailure(failure)).toBe(false);
    }
  });
});
