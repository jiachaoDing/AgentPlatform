import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import { z } from "zod";
import { listenFixture } from "./http";

export function createMcpFixtureHandler() {
  return createMcpHandler(() => {
    const server = new McpServer({ name: "text-fixture", version: "1.0.0" });
    server.registerTool(
      "uppercase",
      { inputSchema: z.object({ text: z.string() }) },
      async ({ text }) => ({
        content: [{ type: "text", text: text.toUpperCase() }],
      }),
    );
    return server;
  });
}

export function startMcpFixture() {
  const handler = createMcpFixtureHandler();
  return listenFixture((request) => handler.fetch(request));
}
