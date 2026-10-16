"use client";

// Public tag and event label for account 710-932-8543, Landing form completed.
const GOOGLE_ADS_ID = "AW-18451509957";
const LEAD_DESTINATION = `${GOOGLE_ADS_ID}/B7bCCP_so4EdEMXlrt5E`;
type GoogleTag = (...args: unknown[]) => void;
declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: GoogleTag;
  }
}
let initialized = false;
const pending = new Set<string>();
const sent = new Set<string>();

function isProductionIntake() {
  return typeof window !== "undefined" &&
    window.location.hostname === "app.spot.insure" &&
    ["/signup", "/intake"].includes(window.location.pathname);
}

function safePageMetadata() {
  // Signup queries include email/handoff capabilities; intake queries include
  // request IDs. Never let gtag infer those URLs, referrers, or page titles.
  return {
    page_location: `${window.location.origin}${window.location.pathname}`,
    page_referrer: "",
    page_title: "Spot insurance intake",
  };
}

export function initializeIntakeGoogleAds() {
  if (!isProductionIntake()) return false;
  if (initialized) return true;
  window.dataLayer ??= [];
  window.gtag ??= function () {
    // Google's bootstrap queue consumes Arguments objects.
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments);
  };
  window.gtag("js", new Date());
  window.gtag("config", GOOGLE_ADS_ID, {
    send_page_view: false,
    ...safePageMetadata(),
  });
  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GOOGLE_ADS_ID}`;
  document.head.appendChild(script);
  initialized = true;
  return true;
}

/** Call only after /api/intake accepts contact details, never on a CTA click. */
export async function trackIntakeContactSaved(handoffKey: string) {
  if (!handoffKey || !isProductionIntake()) return false;
  let transactionId = "";
  try {
    // This random handoff capability is never sent to Google or stored again.
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(handoffKey));
    transactionId = `contact-${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    if (sent.has(transactionId) || pending.has(transactionId)) return false;
    const storageKey = `spot:google-ads:${transactionId}`;
    try {
      if (window.sessionStorage.getItem(storageKey)) return false;
    } catch {
      // Google transaction_id and the in-memory set still deduplicate.
    }
    pending.add(transactionId);
    if (!initializeIntakeGoogleAds()) return false;
    window.gtag!("event", "conversion", {
      send_to: LEAD_DESTINATION,
      transaction_id: transactionId,
      ...safePageMetadata(),
    });
    sent.add(transactionId);
    try {
      window.sessionStorage.setItem(storageKey, "1");
    } catch {
      // Storage restrictions must not affect signup.
    }
    return true;
  } catch {
    // Measurement failures must never turn a saved lead into a signup error.
    return false;
  } finally {
    pending.delete(transactionId);
  }
}
