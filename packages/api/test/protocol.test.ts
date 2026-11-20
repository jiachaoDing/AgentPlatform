import { expect, it, vi } from "vitest";
import { startMcpFixture } from "./fixtures/mcp";
import { TaskState, SendMessageRequest } from "@a2a-js/sdk";
import * as oauth from "oauth4webapi";
import {
  connectMcp,
  createA2aClientFactory,
} from "../src/hub/protocol-clients";

it("官方 MCP SDK 经注入传输完成 HTTP 发现、参数与调用", async () => {
  const server = await startMcpFixture();
  const fetchSpy = vi.fn(server.fetch);
  let client: Awaited<ReturnType<typeof connectMcp>> | undefined;
  try {
    client = await connectMcp(new URL("/mcp", server.origin), fetchSpy);
    const tools = await client.listTools();
    expect(tools.tools[0]?.name).toBe("uppercase");
    const result = await client.callTool({
      name: "uppercase",
      arguments: { text: "hello" },
    });
    expect(result.content).toEqual([{ type: "text", text: "HELLO" }]);
    const invalid = await client.callTool({
      name: "uppercase",
      arguments: { text: 42 },
    });
    expect(invalid.isError).toBe(true);
    expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(3);
  } finally {
    await client?.close();
    await server.close();
  }
});

it("A2A Card 与 JSON-RPC 请求均经过注入传输", async () => {
  const requests: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    requests.push(request.url);
    if (request.method === "GET")
      return Response.json({
        name: "report-fixture",
        description: "Text report",
        version: "1.0.0",
        supportedInterfaces: [
          {
            url: "https://agent.example.invalid/rpc",
            protocolBinding: "JSONRPC",
            protocolVersion: "1.0",
          },
        ],
        capabilities: {},
        defaultInputModes: ["text/plain"],
        defaultOutputModes: ["text/plain"],
        skills: [
          {
            id: "report",
            name: "Report",
            description: "Create report",
            tags: ["text"],
          },
        ],
      });
    const body = (await request.json()) as {
      id: string;
      method: string;
      params: { message: { parts: Array<{ text: string }> } };
    };
    expect(body.params.message.parts[0]?.text).toBe("Generate report");
    return Response.json({
      jsonrpc: "2.0",
      id: body.id,
      result: {
        task: {
          id: "remote-task",
          contextId: "remote-context",
          status: { state: "TASK_STATE_WORKING" },
        },
      },
    });
  };
  const client = await createA2aClientFactory(fetchImpl).createFromUrl(
    "https://agent.example.invalid",
  );
  const result = await client.sendMessage(
    SendMessageRequest.fromJSON({
      message: {
        messageId: "message-1",
        role: "ROLE_USER",
        parts: [{ text: "Generate report" }],
      },
    }),
  );
  expect(result).toHaveProperty("id", "remote-task");
  expect(result).toHaveProperty("status.state", TaskState.TASK_STATE_WORKING);
  expect(requests).toEqual([
    "https://agent.example.invalid/.well-known/agent-card.json",
    "https://agent.example.invalid/rpc",
  ]);
});

it("oauth4webapi 可注入发现传输并生成 PKCE", async () => {
  const issuer = new URL("https://oauth.example.invalid");
  const fetchSpy = vi.fn<typeof fetch>(async () =>
    Response.json({
      issuer: issuer.href,
      authorization_endpoint: `${issuer.origin}/authorize`,
      token_endpoint: `${issuer.origin}/token`,
      response_types_supported: ["code"],
    }),
  );
  const response = await oauth.discoveryRequest(issuer, {
    [oauth.customFetch]: fetchSpy,
    algorithm: "oauth2",
  });
  const metadata = await oauth.processDiscoveryResponse(issuer, response);
  expect(metadata.issuer).toBe(issuer.href);
  expect(fetchSpy).toHaveBeenCalledOnce();
  const verifier = oauth.generateRandomCodeVerifier();
  expect(await oauth.calculatePKCECodeChallenge(verifier)).not.toBe(verifier);
});
