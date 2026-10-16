// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

let host = "app.spot.insure";
let path = "/signup";
const calls: unknown[][] = [];
const storage = new Map<string, string>();
beforeEach(() => {
  vi.resetModules();
  host = "app.spot.insure";
  path = "/signup";
  calls.length = 0;
  storage.clear();
  document.head.innerHTML = "";
  vi.stubGlobal("window", {
    location: { get hostname() { return host; }, get pathname() { return path; }, origin: "https://app.spot.insure" },
    gtag: (...args: unknown[]) => calls.push(args),
    sessionStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  });
});

describe("Google Ads intake lead tracking", () => {
  it("fails closed outside production intake routes", async () => {
    const { initializeIntakeGoogleAds, trackIntakeContactSaved } = await import("./google-ads");
    for (const name of ["localhost", "spot-preview.vercel.app", "other.example"]) {
      host = name;
      expect(initializeIntakeGoogleAds()).toBe(false);
      await trackIntakeContactSaved("private-handoff");
    }
    host = "app.spot.insure";
    for (const route of ["/operator", "/share/private-id", "/requests"]) {
      path = route;
      expect(initializeIntakeGoogleAds()).toBe(false);
    }
    expect(calls).toEqual([]);
    expect(document.scripts).toHaveLength(0);
  });

  it("initializes once without a conversion and sanitizes page metadata", async () => {
    const { initializeIntakeGoogleAds } = await import("./google-ads");
    expect(initializeIntakeGoogleAds()).toBe(true);
    expect(initializeIntakeGoogleAds()).toBe(true);
    expect(document.scripts).toHaveLength(1);
    expect(calls.filter(([event]) => event === "config")).toEqual([
      ["config", "AW-18451509957", {
        send_page_view: false,
        page_location: "https://app.spot.insure/signup",
        page_referrer: "",
        page_title: "Spot insurance intake",
      }],
    ]);
    expect(calls.filter(([event]) => event === "event")).toHaveLength(0);
  });

  it("deduplicates concurrent calls and reloads without sending the handoff token", async () => {
    const { trackIntakeContactSaved } = await import("./google-ads");
    await Promise.all([trackIntakeContactSaved("private-handoff"), trackIntakeContactSaved("private-handoff")]);
    vi.resetModules();
    await (await import("./google-ads")).trackIntakeContactSaved("private-handoff");
    const events = calls.filter(([event]) => event === "event");
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(["event", "conversion", {
      send_to: "AW-18451509957/B7bCCP_so4EdEMXlrt5E",
      transaction_id: expect.stringMatching(/^contact-[a-f0-9]{64}$/),
      page_location: "https://app.spot.insure/signup",
      page_referrer: "",
      page_title: "Spot insurance intake",
    }]);
    expect(JSON.stringify(events)).not.toContain("private-handoff");
  });

  it("does not fail signup when storage or the tracker throws", async () => {
    window.sessionStorage.getItem = () => { throw new Error("storage blocked"); };
    window.gtag = () => { throw new Error("tracker blocked"); };
    await expect((await import("./google-ads")).trackIntakeContactSaved("private-handoff")).resolves.toBe(false);
  });

  it("refuses blank lead identifiers", async () => {
    await expect((await import("./google-ads")).trackIntakeContactSaved("")).resolves.toBe(false);
    expect(calls).toEqual([]);
  });
});
