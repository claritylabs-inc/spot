import { httpRouter } from "convex/server";
import { webhook } from "./openphone";

const http = httpRouter();

http.route({
  path: "/openphone/webhook",
  method: "POST",
  handler: webhook,
});

export default http;
