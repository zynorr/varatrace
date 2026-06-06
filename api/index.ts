import type { IncomingMessage, ServerResponse } from "node:http";
import { buildServer } from "../apps/api/src/server.js";

const app = buildServer();
let ready: PromiseLike<unknown> | null = null;

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  ready ??= app.ready();
  await ready;
  app.server.emit("request", req, res);
}
