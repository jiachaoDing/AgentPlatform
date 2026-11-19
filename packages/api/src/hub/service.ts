import type { Database } from "@agent-platform/db";
import { capabilities } from "@agent-platform/db/schema/hub";
import { eq } from "drizzle-orm";

export function createHub(database: Database) {
  return {
    async listCapabilities(userId: string) {
      return database
        .select({
          id: capabilities.id,
          name: capabilities.name,
          protocol: capabilities.protocol,
          description: capabilities.description,
        })
        .from(capabilities)
        .where(eq(capabilities.userId, userId));
    },
  };
}

export type Hub = ReturnType<typeof createHub>;
