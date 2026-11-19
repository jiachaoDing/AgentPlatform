import { Readable } from "node:stream";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { RPCHandler } from "@orpc/server/fastify";
import { appRouter } from "@agent-platform/api/routers/index";
import type { Context } from "@agent-platform/api/context";
import type { IncomingHttpHeaders } from "node:http";

export type AppOptions = {
  origin: string;
  authUrl: string;
  context(headers: IncomingHttpHeaders): Promise<Context>;
  authHandler(request: Request): Promise<Response>;
  logger?: boolean;
};

export function buildApp(options: AppOptions) {
  const app = Fastify({
    bodyLimit: 256 * 1024,
    logger: options.logger
      ? {
          redact: [
            "req.headers.authorization",
            "req.headers.cookie",
            "res.headers.set-cookie",
          ],
        }
      : false,
  });
  app.register(cors, { origin: options.origin, credentials: true });
  app.addHook("onRequest", async (request, reply) => {
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
    const origin = request.headers.origin;
    const allowed = [options.origin, new URL(options.authUrl).origin];
    if (
      (origin && !allowed.includes(origin)) ||
      (!origin && request.headers.cookie) ||
      request.headers["sec-fetch-site"] === "cross-site"
    ) {
      return reply.code(403).send({ error: "请求来源不被允许" });
    }
  });
  app.get("/health", async () => ({ status: "ok" }));
  app.register(async (rpc) => {
    rpc.removeAllContentTypeParsers();
    rpc.addContentTypeParser("*", (_request, _payload, done) =>
      done(null, undefined),
    );
    const handler = new RPCHandler(appRouter);
    rpc.all("/rpc/*", async (request, reply) => {
      const { matched } = await handler.handle(request, reply, {
        prefix: "/rpc",
        context: await options.context(request.headers),
      });
      if (!matched) return reply.code(404).send({ error: "NOT_FOUND" });
    });
  });
  app.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    async handler(request, reply) {
      const headers = new Headers();
      for (const [key, value] of Object.entries(request.headers)) {
        if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
        else if (value) headers.set(key, value);
      }
      const response = await options.authHandler(
        new Request(new URL(request.url, options.authUrl), {
          method: request.method,
          headers,
          body:
            request.method === "POST"
              ? JSON.stringify(request.body)
              : undefined,
        }),
      );
      reply.code(response.status);
      response.headers.forEach((value, key) => {
        if (key !== "set-cookie") reply.header(key, value);
      });
      const cookies = response.headers.getSetCookie();
      if (cookies.length) reply.header("set-cookie", cookies);
      return reply.send(response.body ? Readable.from(response.body) : null);
    },
  });
  app.post("/api/chat", async (request, reply) => {
    const context = await options.context(request.headers);
    if (!context.session) return reply.code(401).send({ error: "请先登录" });
    if (!context.modules.playground)
      return reply.code(404).send({ error: "AI 工作台未启用" });
    return reply.code(503).send({ error: "模型接入尚未就绪，请联系管理员" });
  });
  app.setErrorHandler((error, request, reply) => {
    request.log.error({ requestId: request.id }, "Request failed");
    const status =
      typeof error === "object" &&
      error &&
      "statusCode" in error &&
      typeof error.statusCode === "number"
        ? error.statusCode
        : 500;
    reply.code(status >= 400 && status < 500 ? status : 500).send({
      error: status === 413 ? "请求内容过大" : "请求无法处理",
      requestId: request.id,
    });
  });
  return app;
}
