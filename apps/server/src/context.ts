import type { IncomingHttpHeaders } from "node:http";

import type { Context as ApiContext } from "@agent-platform/api/context";
import { fromNodeHeaders } from "better-auth/node";

import { hub, auth } from "./services";
import { ENV } from "./env.server";

export async function createContext(
  req: IncomingHttpHeaders,
): Promise<ApiContext> {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(req),
  });
  return {
    hub,
    session,
    modules: { market: ENV.ENABLE_MARKET, playground: ENV.ENABLE_PLAYGROUND },
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
