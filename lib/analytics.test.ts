// @vitest-environment happy-dom
// Boundaries: readable ordinary values must not expose credentials, OTPs or access URLs.
import { expect, test, vi } from "vitest";
const init = vi.hoisted(() => vi.fn());
vi.mock("posthog-js/full/no-external", () => ({ default: { init } }));
import { initAnalytics } from "./analytics";
initAnalytics();
const config = init.mock.calls[0][1];
const replay = config.session_recording;

test("ordinary replay text, input values and presentation attributes are readable", () => {
  expect(replay.maskAllInputs).toBe(false);
  const label = document.createElement("label");
  expect(label.matches(replay.maskTextSelector)).toBe(false);
  expect(
    replay.maskAttributeFn("aria-label", "Coverage selection", label),
  ).toBe("Coverage selection");
  expect(
    replay.maskAttributeFn(
      "value",
      "Fixture company",
      document.createElement("input"),
    ),
  ).toBe("Fixture company");
});

test("credentials and OTP containers remain blocked even with revealed passwords", () => {
  for (const html of [
    '<input type="password">',
    '<input type="text" autocomplete="current-password">',
    '<input type="text" name="password">',
    '<input autocomplete="one-time-code">',
    '<input type="hidden" value="secret">',
    '<div class="ph-no-capture">123456</div>',
  ]) {
    const fixture = document.createElement("div");
    fixture.innerHTML = html;
    expect(fixture.firstElementChild!.matches(replay.blockSelector)).toBe(true);
  }
  expect(
    replay.maskAttributeFn(
      "data-access-token",
      "secret",
      document.createElement("div"),
    ),
  ).toBe("[redacted]");
});

test("access-bearing URLs and request bodies remain excluded", () => {
  expect(
    replay.maskAttributeFn(
      "href",
      "/intake?verify=secret",
      document.createElement("a"),
    ),
  ).toBe("/intake");
  expect(replay.recordHeaders).toBe(false);
  expect(replay.recordBody).toBe(false);
});
