import { randomUUID } from "node:crypto";
import {
  AgentCard,
  Message,
  SendMessageRequest,
  Task,
  TaskState,
  TaskStatusUpdateEvent,
} from "@a2a-js/sdk";
import {
  AgentEvent,
  DefaultRequestHandler,
  InMemoryTaskStore,
  JsonRpcTransportHandler,
  ServerCallContext,
} from "@a2a-js/sdk/server";
import { listenFixture } from "./http";

export function textMessage(text: string, returnImmediately = false) {
  return SendMessageRequest.fromJSON({
    configuration: { returnImmediately },
    message: { messageId: randomUUID(), role: "ROLE_USER", parts: [{ text }] },
  });
}

export async function startA2aFixture() {
  let rpc: JsonRpcTransportHandler;
  let card: AgentCard;
  const completion = Promise.withResolvers<void>();
  const server = await listenFixture(async (request) => {
    const path = new URL(request.url).pathname;
    if (request.method === "GET" && path === "/.well-known/agent-card.json") {
      return Response.json(AgentCard.toJSON(card));
    }
    if (request.method !== "POST" || path !== "/rpc")
      return new Response(null, { status: 404 });
    const response = await rpc.handle(
      await request.text(),
      new ServerCallContext({
        requestedVersion: request.headers.get("a2a-version") ?? undefined,
      }),
    );
    return Response.json(response);
  });
  card = AgentCard.fromJSON({
    name: "text-report-fixture",
    description: "Creates a text report",
    version: "1.0.0",
    supportedInterfaces: [
      {
        url: `${server.origin}/rpc`,
        protocolBinding: "JSONRPC",
        protocolVersion: "1.0",
      },
    ],
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    skills: [
      {
        id: "report",
        name: "Report",
        description: "Format text",
        tags: ["text"],
      },
    ],
  });
  const handler = new DefaultRequestHandler(card, new InMemoryTaskStore(), {
    async execute(context, bus) {
      const part = context.userMessage.parts[0]?.content;
      const text = part?.$case === "text" ? part.value : "";
      if (!text.startsWith("task:")) {
        bus.publish(
          AgentEvent.message(
            Message.fromJSON({
              messageId: randomUUID(),
              role: "ROLE_AGENT",
              contextId: context.contextId,
              parts: [{ text: `REPORT: ${text}` }],
            }),
          ),
        );
        return;
      }
      const { taskId, contextId } = context;
      bus.publish(
        AgentEvent.task(
          Task.fromJSON({
            id: taskId,
            contextId,
            status: { state: "TASK_STATE_WORKING" },
          }),
        ),
      );
      const state =
        text === "task:input"
          ? TaskState.TASK_STATE_INPUT_REQUIRED
          : text === "task:fail"
            ? TaskState.TASK_STATE_FAILED
            : TaskState.TASK_STATE_COMPLETED;
      if (state === TaskState.TASK_STATE_COMPLETED) await completion.promise;
      bus.publish(
        AgentEvent.statusUpdate(
          TaskStatusUpdateEvent.fromJSON({
            taskId,
            contextId,
            status: { state },
          }),
        ),
      );
    },
    async cancelTask() {
      throw new Error("This fixture only exercises send and get");
    },
  });
  rpc = new JsonRpcTransportHandler(handler);
  return {
    ...server,
    completeTask: () => completion.resolve(),
    close: async () => {
      completion.resolve();
      await server.close();
    },
  };
}
