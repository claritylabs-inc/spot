/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as coiGenerator from "../coiGenerator.js";
import type * as crons from "../crons.js";
import type * as email from "../email.js";
import type * as emailActions from "../emailActions.js";
import type * as emailWebhook from "../emailWebhook.js";
import type * as http from "../http.js";
import type * as imageUtils from "../imageUtils.js";
import type * as imessageBridge from "../imessageBridge.js";
import type * as ingest from "../ingest.js";
import type * as linq from "../linq.js";
import type * as messages from "../messages.js";
import type * as openphone from "../openphone.js";
import type * as policies from "../policies.js";
import type * as process from "../process.js";
import type * as reminderActions from "../reminderActions.js";
import type * as reminders from "../reminders.js";
import type * as send from "../send.js";
import type * as sendBridge from "../sendBridge.js";
import type * as sendLinq from "../sendLinq.js";
import type * as upload from "../upload.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  coiGenerator: typeof coiGenerator;
  crons: typeof crons;
  email: typeof email;
  emailActions: typeof emailActions;
  emailWebhook: typeof emailWebhook;
  http: typeof http;
  imageUtils: typeof imageUtils;
  imessageBridge: typeof imessageBridge;
  ingest: typeof ingest;
  linq: typeof linq;
  messages: typeof messages;
  openphone: typeof openphone;
  policies: typeof policies;
  process: typeof process;
  reminderActions: typeof reminderActions;
  reminders: typeof reminders;
  send: typeof send;
  sendBridge: typeof sendBridge;
  sendLinq: typeof sendLinq;
  upload: typeof upload;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
