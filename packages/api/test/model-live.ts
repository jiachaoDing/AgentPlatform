import { randomBytes } from "node:crypto";
import type { JSONSchema7 } from "ai";
import { createPublicTransport } from "../src/network/public-fetch";
import {
  connectMcp,
  createA2aClientFactory,
} from "../src/hub/protocol-clients";
import { createCompatibleModel } from "../src/playground/model";
import { runPlayground } from "../src/playground/runner";
import { startA2aFixture, textMessage } from "./fixtures/a2a";
import { startMcpFixture } from "./fixtures/mcp";

async function main() {
  const {
    AEC_MODEL_BASE_URL: baseURL,
    AEC_MODEL_API_KEY: apiKey,
    AEC_MODEL_ID: modelId,
  } = process.env;
  if (!baseURL || !apiKey || !modelId) {
    console.error(
      "Configure AEC_MODEL_BASE_URL, AEC_MODEL_API_KEY and AEC_MODEL_ID in the server environment.",
    );
    return false;
  }
  const transport = createPublicTransport({ timeoutMs: 55_000 });
  let mcpServer: Awaited<ReturnType<typeof startMcpFixture>> | undefined;
  let a2aServer: Awaited<ReturnType<typeof startA2aFixture>> | undefined;
  let mcp: Awaited<ReturnType<typeof connectMcp>> | undefined;
  let stage = "fixture setup";
  let modelRequests = 0;
  let modelStatus: number | undefined;
  try {
    mcpServer = await startMcpFixture();
    a2aServer = await startA2aFixture();
    const mcpClient = (mcp = await connectMcp(
      new URL("/mcp", mcpServer.origin),
      mcpServer.fetch,
    ));
    const tool = (await mcpClient.listTools()).tools.find(
      ({ name }) => name === "uppercase",
    );
    if (!tool) throw new Error("Expected MCP fixture tool");
    const agent = await createA2aClientFactory(a2aServer.fetch).createFromUrl(
      a2aServer.origin,
    );
    const model = createCompatibleModel(
      { baseURL, apiKey, modelId },
      async (input, init) => {
        modelRequests++;
        const response = await transport.fetch(input, init);
        modelStatus = response.status;
        return response;
      },
    );
    const input = `sample-${randomBytes(5).toString("hex")}`;
    const uppercase = input.toUpperCase();
    const expected = `REPORT: ${uppercase}`;
    const calls: string[] = [];
    stage = "tool loop";
    const result = await runPlayground({
      userId: "smoke-user",
      sessionId: "smoke-session",
      capabilityIds: ["mcp", "a2a"],
      model,
      messages: [
        {
          role: "user",
          content: `Use uppercase first on ${input}. Then call report with the exact uppercase tool summary. Finally return only the exact report tool summary. Do not perform either operation yourself.`,
        },
      ],
      hub: {
        async listAuthorizedTools() {
          return [
            {
              name: tool.name,
              capabilityId: "mcp",
              version: "1",
              description: "Uppercase text via MCP.",
              inputSchema: tool.inputSchema as JSONSchema7,
            },
            {
              name: "report",
              capabilityId: "a2a",
              version: "1",
              description: "Create a text report via A2A.",
              inputSchema: {
                type: "object",
                properties: { text: { type: "string" } },
                required: ["text"],
                additionalProperties: false,
              },
            },
          ];
        },
        async execute({ capabilityId, args }) {
          const { text } = args as { text: string };
          let summary: string | undefined;
          if (capabilityId === "mcp" && calls.length === 0 && text === input) {
            const { content, isError } = await mcpClient.callTool({
              name: tool.name,
              arguments: { text },
            });
            const part = Array.isArray(content) ? content[0] : undefined;
            if (!isError && part?.type === "text" && part.text === uppercase)
              summary = part.text;
          } else if (
            capabilityId === "a2a" &&
            calls.join() === "mcp" &&
            text === uppercase
          ) {
            const response = await agent.sendMessage(textMessage(text));
            const part =
              "parts" in response ? response.parts[0]?.content : undefined;
            if (part?.$case === "text" && part.value === expected)
              summary = part.value;
          }
          if (!summary) throw new Error("Unexpected tool call or result");
          calls.push(capabilityId);
          return {
            executionId: `smoke-${capabilityId}`,
            status: "succeeded",
            summary,
          };
        },
      },
    });
    if (
      calls.join() !== "mcp,a2a" ||
      modelRequests < 3 ||
      !result.text.includes(expected)
    ) {
      throw new Error("Expected MCP then A2A with final result");
    }
    console.log(
      JSON.stringify({
        ok: true,
        model: modelId,
        modelRequests,
        calls,
        finalResultVerified: true,
      }),
    );
    return true;
  } catch {
    // Provider errors can contain credentials, payloads and headers.
    console.error(
      JSON.stringify({ ok: false, stage, modelRequests, modelStatus }),
    );
    return false;
  } finally {
    await Promise.allSettled([
      mcp?.close(),
      mcpServer?.close(),
      a2aServer?.close(),
      transport.close(),
    ]);
  }
}

main().then(
  (ok) => {
    if (!ok) process.exitCode = 1;
  },
  () => {
    console.error("Live smoke fixture startup failed.");
    process.exitCode = 1;
  },
);
