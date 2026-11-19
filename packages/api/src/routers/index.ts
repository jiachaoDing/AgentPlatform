import type { RouterClient } from "@orpc/server";
import { z } from "zod";
import { protectedProcedure, publicProcedure } from "../index";

export const appRouter = {
  system: publicProcedure
    .output(
      z.object({
        market: z.boolean(),
        playground: z.boolean(),
      }),
    )
    .handler(({ context }) => context.modules),
  capabilities: {
    list: protectedProcedure
      .output(
        z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            protocol: z.enum(["mcp", "a2a"]),
            description: z.string(),
          }),
        ),
      )
      .handler(({ context }) =>
        context.hub.listCapabilities(context.session.user.id),
      ),
  },
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
