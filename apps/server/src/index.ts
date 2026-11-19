import { buildApp } from "./app";
import { createContext } from "./context";
import { ENV } from "./env.server";
import { auth, db } from "./services";

const app = buildApp({
  origin: ENV.CORS_ORIGIN,
  authUrl: ENV.BETTER_AUTH_URL,
  context: createContext,
  authHandler: (request) => auth.handler(request),
  logger: true,
});
app.addHook("onClose", async () => {
  await db.$client.end();
});
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void app.close();
  });
await app.listen({ port: ENV.PORT, host: ENV.HOST });
