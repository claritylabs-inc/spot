import { httpRouter } from "convex/server";
import { webhook as openphoneWebhook } from "./openphone";
import { webhook as linqWebhook } from "./linq";

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

export default http;
