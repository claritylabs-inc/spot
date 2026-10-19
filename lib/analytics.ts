"use client";

import posthog from "posthog-js/full/no-external";

// Public, write-only ingestion token for the Spot project; never a personal API key.
const projectToken =
  process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN ||
  "phc_r4wwom2cwB995w8VgdddnTa8faLVthutqXr6YUG298ZT";
let initialized = false;

/** URLs never include access tokens, query parameters, or individual record IDs. */
export function analyticsPath(path: string): string {
  return path
    .split(/[?#]/)[0]
    .split("/")
    .map((part) => (/^[a-z0-9_-]{20,}$/i.test(part) ? ":id" : part))
    .join("/");
}

export function initAnalytics() {
  if (
    initialized ||
    typeof window === "undefined" ||
    process.env.NEXT_PUBLIC_POSTHOG_DISABLED === "true"
  )
    return;
  initialized = true;
  posthog.init(projectToken, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || "/ingest",
    ui_host: "https://us.posthog.com",
    defaults: "2025-11-30",
    capture_pageview: false,
    capture_pageleave: true,
    autocapture: true,
    capture_dead_clicks: true,
    capture_performance: { web_vitals: true },
    capture_exceptions: true,
    person_profiles: "identified_only",
    mask_all_text: true,
    mask_all_element_attributes: true,
    disable_session_recording: false,
    enable_recording_console_log: false,
    session_recording: {
      inlineStylesheet: true,
      maskAllInputs: false,
      maskInputOptions: { password: true },
      maskAllElementAttributes: false,
      maskAttributeFn: (name, value, element) => {
        // rrweb replaces stylesheet links with this synthetic attribute. Redacting
        // it removes the entire stylesheet, even when class/style are preserved.
        if (
          name === "_cssText" &&
          (element?.tagName === "LINK" || element?.tagName === "STYLE")
        )
          return value;
        // Keep visible UI attributes intact while excluding access capabilities.
        if (/token|secret|password|authorization/i.test(name))
          return "[redacted]";
        if (
          name === "href" &&
          element?.tagName === "LINK" &&
          element.getAttribute("rel") === "stylesheet"
        )
          return value;
        if (name === "href" || name === "src") return analyticsPath(value);
        return value;
      },
      maskTextSelector: ".ph-mask",
      blockSelector:
        'canvas, iframe, object, embed, input[type=file], input[type=hidden], input[type=password], input[autocomplete="current-password"], input[autocomplete="new-password"], input[autocomplete="one-time-code"], input[name*="password" i], .ph-no-capture',
      recordHeaders: false,
      recordBody: false,
      recordCrossOriginIframes: false,
      maskCapturedNetworkRequestFn: (request) => ({
        ...request,
        name: analyticsPath(request.name),
      }),
    },
    before_send: (event) => {
      if (!event) return null;
      // Visible UI is recorded; access-bearing navigation metadata is sanitized separately.
      if (Array.isArray(event.properties.$snapshot_data)) {
        for (const snapshot of event.properties.$snapshot_data) {
          if (snapshot.type === 4 && typeof snapshot.data?.href === "string")
            snapshot.data.href = analyticsPath(snapshot.data.href);
        }
      }
      for (const key of [
        "$current_url",
        "$referrer",
        "$initial_current_url",
        "$initial_referrer",
        "$pathname",
      ]) {
        if (typeof event.properties[key] === "string")
          event.properties[key] = analyticsPath(event.properties[key]);
      }
      for (const personKey of ["$set", "$set_once"]) {
        const person = event.properties[personKey];
        if (person && typeof person === "object") {
          for (const key of Object.keys(person)) {
            if (
              /url|referrer|pathname/.test(key) &&
              typeof person[key] === "string"
            )
              person[key] = analyticsPath(person[key]);
            if (/title|utm_|gclid|fbclid/.test(key)) delete person[key];
          }
        }
      }
      // Error messages can echo user input; preserve stack/type without the raw message.
      if (Array.isArray(event.properties.$exception_list)) {
        for (const exception of event.properties.$exception_list) {
          exception.value = "[message redacted]";
        }
      }
      delete event.properties.$title;
      delete event.properties.$initial_title;
      delete event.properties.$exception_personURL;
      return event;
    },
    loaded: (client) =>
      client.register({
        app: "spot",
        environment: process.env.NEXT_PUBLIC_VERCEL_ENV || process.env.NODE_ENV,
      }),
  });
}

type AnalyticsEvent =
  | "intake_goal_selected"
  | "intake_step_viewed"
  | "intake_submission_started"
  | "intake_submitted"
  | "intake_resubmitted"
  | "intake_submission_failed"
  | "intake_upload_finished";

/** Only structural metadata belongs here, never answers, filenames, or prose. */
export function captureAnalytics(
  event: AnalyticsEvent,
  properties: Record<string, string | number | boolean> = {},
) {
  if (!initialized) return;
  posthog.capture(event, properties);
}

export { posthog };
