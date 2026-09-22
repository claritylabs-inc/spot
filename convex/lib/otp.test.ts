import { expect, test, vi } from "vitest";
import { generateOtpCode } from "./otp";

test("generates a 6-digit numeric code within range", () => {
  for (let i = 0; i < 1000; i++) {
    const code = generateOtpCode();
    expect(code).toMatch(/^\d{6}$/);
    const value = Number(code);
    expect(value).toBeGreaterThanOrEqual(100000);
    expect(value).toBeLessThanOrEqual(999999);
  }
});

test("uses crypto.getRandomValues rather than Math.random", () => {
  const spy = vi.spyOn(crypto, "getRandomValues");
  generateOtpCode();
  expect(spy).toHaveBeenCalled();
  spy.mockRestore();
});
