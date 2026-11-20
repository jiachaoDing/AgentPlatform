import { expect, it, vi } from "vitest";
import { GetTaskRequest, TaskState } from "@a2a-js/sdk";
import { createA2aClientFactory } from "../src/hub/protocol-clients";
import { startA2aFixture, textMessage } from "./fixtures/a2a";

it("官方 A2A 1.0 SDK 经 HTTP 发现 Card、返回文本与续查同一任务", async () => {
  const server = await startA2aFixture();
  try {
    const wire = vi.fn(server.fetch);
    const client = await createA2aClientFactory(wire).createFromUrl(
      server.origin,
    );
    const direct = await client.sendMessage(textMessage("test"));
    expect(direct).toHaveProperty("parts.0.content.value", "REPORT: test");
    expect(String(wire.mock.calls[0]?.[0])).toBe(
      `${server.origin}/.well-known/agent-card.json`,
    );
    const task = await client.sendMessage(textMessage("task:complete", true));
    if (!("id" in task)) throw new Error("Expected task response");
    const query = GetTaskRequest.fromJSON({ id: task.id });
    expect((await client.getTask(query)).status?.state).toBe(
      TaskState.TASK_STATE_WORKING,
    );
    server.completeTask();
    await vi.waitFor(async () => {
      const completed = await client.getTask(query);
      expect(completed.id).toBe(task.id);
      expect(completed.status?.state).toBe(TaskState.TASK_STATE_COMPLETED);
    });
  } finally {
    await server.close();
  }
});

it("A2A 需要输入及远端失败在 HTTP 响应中保留真实状态", async () => {
  const server = await startA2aFixture();
  try {
    const client = await createA2aClientFactory(server.fetch).createFromUrl(
      server.origin,
    );
    expect(await client.sendMessage(textMessage("task:input"))).toHaveProperty(
      "status.state",
      TaskState.TASK_STATE_INPUT_REQUIRED,
    );
    expect(await client.sendMessage(textMessage("task:fail"))).toHaveProperty(
      "status.state",
      TaskState.TASK_STATE_FAILED,
    );
  } finally {
    await server.close();
  }
});
