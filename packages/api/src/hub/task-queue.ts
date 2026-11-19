import { PgBoss, fromDrizzle } from "pg-boss";
import { sql } from "drizzle-orm";
import type { Database } from "@agent-platform/db";

export const TASK_QUERY_QUEUE = "query-remote-task";
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export function createTaskQueue(databaseUrl: string): PgBoss {
  return new PgBoss({ connectionString: databaseUrl, schema: "hub_jobs" });
}

// Consumers must reload the execution and recheck authorization before querying.
export function enqueueTaskQuery(
  queue: PgBoss,
  tx: Transaction,
  executionId: string,
) {
  return queue.send(
    TASK_QUERY_QUEUE,
    { executionId },
    { db: fromDrizzle(tx, sql), retryLimit: 3 },
  );
}
