import { afterAll, beforeAll, expect, it } from "vitest";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { createDb } from "../packages/db/src";
import {
  createTaskQueue,
  enqueueTaskQuery,
  TASK_QUERY_QUEUE,
} from "../packages/api/src/hub/task-queue";

let container: StartedPostgreSqlContainer;
let database: ReturnType<typeof createDb>;
let queue: ReturnType<typeof createTaskQueue>;
beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17.7-alpine").start();
  database = createDb({ DATABASE_URL: container.getConnectionUri() });
  queue = createTaskQueue(container.getConnectionUri());
  await queue.start();
  await queue.createQueue(TASK_QUERY_QUEUE);
});
afterAll(async () => {
  await queue?.stop();
  await database?.$client.end();
  await container?.stop();
});

it("任务与 Drizzle 事务共同回滚", async () => {
  await expect(
    database.transaction(async (tx) => {
      await enqueueTaskQuery(queue, tx, "rolled-back");
      throw new Error("rollback");
    }),
  ).rejects.toThrow("rollback");
  expect(await queue.fetch(TASK_QUERY_QUEUE)).toEqual([]);
});
it("提交任务在队列重启后仍可取得并完成", async () => {
  const id = await database.transaction((tx) =>
    enqueueTaskQuery(queue, tx, "execution-1"),
  );
  await queue.stop();
  queue = createTaskQueue(container.getConnectionUri());
  await queue.start();
  const jobs = await queue.fetch<{ executionId: string }>(TASK_QUERY_QUEUE);
  expect(jobs).toHaveLength(1);
  expect(jobs[0]?.id).toBe(id);
  expect(jobs[0]?.data).toEqual({ executionId: "execution-1" });
  await queue.complete(TASK_QUERY_QUEUE, jobs[0]!.id);
  expect(await queue.fetch(TASK_QUERY_QUEUE)).toEqual([]);
});
