import { httpRouter } from "convex/server";
import { webhook as openphoneWebhook } from "./openphone";
import { webhook as linqWebhook } from "./linq";
import { webhook as imessageBridgeWebhook } from "./imessageBridge";
import { webhook as emailWebhook } from "./emailWebhook";

const http = httpRouter();

http.route({
  path: "/openphone/webhook",
  method: "POST",
  handler: openphoneWebhook,
});

http.route({
  path: "/linq/webhook",
  method: "POST",
  handler: linqWebhook,
});

http.route({
  path: "/imessage/webhook",
  method: "POST",
  handler: imessageBridgeWebhook,
});

http.route({
  path: "/email/webhook",
  method: "POST",
  handler: emailWebhook,
});

export default http;
