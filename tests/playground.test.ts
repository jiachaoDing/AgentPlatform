import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { createCompatibleModel } from "../packages/api/src/playground/model";
import {
  runPlayground,
  streamPlayground,
  type ExecutionGateway,
  type ExecutionResult,
  type RunOptions,
} from "../packages/api/src/playground/runner";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
const endpoint = "https://model.example.invalid/v1/chat/completions";
function completion(message: unknown, reason: string) {
  return HttpResponse.json({
    id: "test-completion",
    object: "chat.completion",
    created: 1,
    model: "test-model",
    choices: [{ index: 0, message, finish_reason: reason }],
    usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
  });
}
function options(hub: ExecutionGateway): RunOptions {
  return {
    model: createCompatibleModel(
      {
        baseURL: "https://model.example.invalid/v1",
        modelId: "test-model",
        apiKey: "test-only-placeholder",
      },
      fetch,
    ),
    userId: "user-a",
    sessionId: "session-a",
    capabilityIds: ["mcp-a", "a2a-b"],
    messages: [{ role: "user", content: "处理文本后生成报告" }],
    hub,
  };
}
function gateway(
  status: ExecutionResult["status"] = "succeeded",
): ExecutionGateway {
  return {
    listAuthorizedTools: vi.fn<ExecutionGateway["listAuthorizedTools"]>(
      async () => [
        {
          name: "text_tool",
          capabilityId: "mcp-a",
          version: "v1",
          description: "Process text",
          inputSchema: {
            type: "object",
            properties: { text: { type: "string" } },
            required: ["text"],
          },
        },
        {
          name: "report_agent",
          capabilityId: "a2a-b",
          version: "v1",
          description: "Create report",
          inputSchema: {
            type: "object",
            properties: { text: { type: "string" } },
            required: ["text"],
          },
        },
      ],
    ),
    execute: vi.fn(async (request) => ({
      executionId: request.toolCallId,
      status,
      summary: "真实替身结果",
    })),
  };
}

describe("Vercel AI SDK 经 Hub 执行", () => {
  it("完成 MCP → A2A → 回答，服务端身份和版本传入 Hub", async () => {
    const requests: any[] = [];
    server.use(
      http.post(endpoint, async ({ request }) => {
        requests.push(await request.json());
        if (requests.length <= 2)
          return completion(
            {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: `call-${requests.length}`,
                  type: "function",
                  function: {
                    name: requests.length === 1 ? "text_tool" : "report_agent",
                    arguments: JSON.stringify({ text: "输入文本" }),
                  },
                },
              ],
            },
            "tool_calls",
          );
        return completion(
          { role: "assistant", content: "报告已完成。" },
          "stop",
        );
      }),
    );
    const hub = gateway();
    const result = await runPlayground(options(hub));
    expect(result.text).toBe("报告已完成。");
    expect(hub.execute).toHaveBeenCalledTimes(2);
    expect(hub.execute).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        userId: "user-a",
        sessionId: "session-a",
        capabilityId: "mcp-a",
        version: "v1",
        toolName: "text_tool",
      }),
    );
    expect(hub.execute).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ capabilityId: "a2a-b" }),
    );
    expect(
      requests[2].messages.filter((m: any) => m.role === "tool"),
    ).toHaveLength(2);
  });
  it.each([
    "waiting_confirmation",
    "remote_running",
    "input_required",
    "unknown",
  ] as const)("%s 时停止模型循环", async (status) => {
    let calls = 0;
    server.use(
      http.post(endpoint, () => {
        calls++;
        return completion(
          {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call-1",
                type: "function",
                function: { name: "text_tool", arguments: '{"text":"hi"}' },
              },
            ],
          },
          "tool_calls",
        );
      }),
    );
    await runPlayground(options(gateway(status)));
    expect(calls).toBe(1);
  });
  it("模型返回无效参数不会触达 Hub", async () => {
    let calls = 0;
    server.use(
      http.post(endpoint, () =>
        ++calls === 1
          ? completion(
              {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call-1",
                    type: "function",
                    function: { name: "text_tool", arguments: '{"text":42}' },
                  },
                ],
              },
              "tool_calls",
            )
          : completion({ role: "assistant", content: "参数错误。" }, "stop"),
      ),
    );
    const hub = gateway();
    await runPlayground(options(hub));
    expect(hub.execute).not.toHaveBeenCalled();
  });
  it("输出 assistant-ui 可消费的 UI 消息流", async () => {
    server.use(
      http.post(
        endpoint,
        () =>
          new HttpResponse(
            [
              {
                choices: [
                  {
                    index: 0,
                    delta: { role: "assistant", content: "你好" },
                    finish_reason: null,
                  },
                ],
              },
              { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
            ]
              .map(
                (chunk) =>
                  `data: ${JSON.stringify({ id: "s1", object: "chat.completion.chunk", created: 1, model: "test-model", ...chunk })}\n\n`,
              )
              .join("") + "data: [DONE]\n\n",
            { headers: { "Content-Type": "text/event-stream" } },
          ),
      ),
    );
    const response = await streamPlayground(options(gateway()));
    expect(response.headers.get("x-vercel-ai-ui-message-stream")).toBe("v1");
    const body = await response.text();
    expect(body).toContain("你好");
    expect(body).toContain("text-delta");
    expect(body).toContain("[DONE]");
  });
  it("Hub 异常不会泄露内部错误或继续提交工具", async () => {
    let calls = 0;
    server.use(
      http.post(endpoint, () => {
        calls++;
        return completion(
          {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call-1",
                type: "function",
                function: { name: "text_tool", arguments: '{"text":"hi"}' },
              },
            ],
          },
          "tool_calls",
        );
      }),
    );
    const hub = gateway();
    hub.execute = vi.fn(async () => {
      throw new Error("internal-test-secret");
    });
    const result = await runPlayground(options(hub));
    expect(calls).toBe(1);
    expect(JSON.stringify(result.steps)).not.toContain("internal-test-secret");
    expect(hub.execute).toHaveBeenCalledOnce();
  });
});
