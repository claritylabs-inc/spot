import { afterEach, expect, test, vi } from "vitest";
import { jevProceedThreshold, jevProceeds } from "./jevThreshold";

afterEach(() => vi.unstubAllEnvs());

test("defaults to 70% sure = proceed", () => {
  expect(jevProceedThreshold()).toBe(0.7);
  expect(jevProceeds(0.7)).toBe(true);
  expect(jevProceeds(0.69)).toBe(false);
  expect(jevProceeds(undefined)).toBe(false);
});

test("JEV_PROCEED_THRESHOLD overrides the default within 0.5–0.99", () => {
  vi.stubEnv("JEV_PROCEED_THRESHOLD", "0.8");
  expect(jevProceeds(0.79)).toBe(false);
  expect(jevProceeds(0.8)).toBe(true);
});

test("out-of-range or invalid values fall back to the default", () => {
  for (const value of ["0.3", "1", "abc", ""]) {
    vi.stubEnv("JEV_PROCEED_THRESHOLD", value);
    expect(jevProceedThreshold()).toBe(0.7);
  }
});
