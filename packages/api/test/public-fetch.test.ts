import { afterEach, expect, it, vi } from "vitest";
import { createA2aClientFactory } from "../src/hub/protocol-clients";
import { AgentCard, SendMessageRequest } from "@a2a-js/sdk";
import {
  createPublicTransport,
  parsePublicUrl,
} from "../src/network/public-fetch";

afterEach(() => vi.restoreAllMocks());

it("仅接受公网 HTTPS 默认端口，拒绝特殊 IP 及非公网名称", () => {
  expect(parsePublicUrl("https://example.com:443/mcp").origin).toBe(
    "https://example.com",
  );
  expect(parsePublicUrl("https://[2606:4700::1]").hostname).toBe(
    "[2606:4700::1]",
  );
  for (const url of [
    "http://example.com",
    "https://example.com:8443",
    "https://user:pass@example.com",
    "https://example.com/#settings",
    "https://sub.localhost.",
    "https://metadata.google.internal",
    "https://2130706433",
    "https://169.254.169.254",
    "https://10.0.0.1",
    "https://192.0.2.1",
    "https://100.64.0.1",
    "https://168.63.129.16",
    "https://[::1]",
    "https://[::ffff:127.0.0.1]",
    "https://[fe80::1]",
    "https://[fd00::1]",
    "https://[2001:db8::1]",
    "https://[64:ff9b::1]",
  ])
    expect(() => parsePublicUrl(url), url).toThrow();
});

it("实际连接的 DNS 回调检查所有地址，有任一私网地址即失败", async () => {
  const resolve = vi.fn(async () => [
    { address: "1.1.1.1", family: 4 },
    { address: "::1", family: 6 },
  ]);
  const transport = createPublicTransport({ resolve });
  try {
    await expect(
      transport.fetch("https://mixed.example.invalid"),
    ).rejects.toHaveProperty("cause.message", "目标 IP 不允许访问");
    expect(resolve).toHaveBeenCalledExactlyOnceWith("mixed.example.invalid");
  } finally {
    await transport.close();
  }
});

it("逐跳检查目标，且不把自定义头或凭证带到后续请求", async () => {
  const start = "https://start.example.invalid/metadata";
  const next = "https://next.example.invalid/metadata";
  const wire = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: next } }),
    )
    .mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "https://127.0.0.1" },
      }),
    );
  const transport = createPublicTransport();
  try {
    await expect(
      transport.fetch(start, { headers: { "x-api-key": "fixture-key" } }),
    ).rejects.toThrow("目标 IP");
    expect(wire).toHaveBeenCalledTimes(2);
    const redirected = wire.mock.calls[1]![0] as Request;
    expect(redirected.url).toBe(next);
    expect([...redirected.headers]).toEqual([]);
    wire.mockResolvedValueOnce(
      new Response(null, { status: 307, headers: { location: next } }),
    );
    await expect(
      transport.fetch(start, {
        method: "POST",
        body: "fixture",
        headers: { authorization: "Bearer fixture" },
      }),
    ).rejects.toThrow("重定向");
    expect(wire).toHaveBeenCalledTimes(3);
  } finally {
    await transport.close();
  }
});

it("不能用公开 A2A Card 将执行流量指向私网", async () => {
  const transport = createPublicTransport();
  const wire = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    Response.json(
      AgentCard.toJSON(
        AgentCard.fromJSON({
          name: "card-fixture",
          description: "Fixture",
          version: "1.0.0",
          supportedInterfaces: [
            {
              url: "https://127.0.0.1/rpc",
              protocolBinding: "JSONRPC",
              protocolVersion: "1.0",
            },
          ],
          defaultInputModes: ["text/plain"],
          defaultOutputModes: ["text/plain"],
        }),
      ),
    ),
  );
  try {
    const client = await createA2aClientFactory(transport.fetch).createFromUrl(
      "https://agent.example.invalid",
    );
    await expect(
      client.sendMessage(
        SendMessageRequest.fromJSON({
          message: {
            messageId: "fixture",
            role: "ROLE_USER",
            parts: [{ text: "report" }],
          },
        }),
      ),
    ).rejects.toThrow();
    expect(wire).toHaveBeenCalledOnce();
  } finally {
    await transport.close();
  }
});

it("限制解码后的响应流大小，不预读有限流式片段", async () => {
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(Uint8Array.of(1, 2));
      controller.enqueue(Uint8Array.of(3, 4));
      controller.close();
    },
  });
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(source));
  const transport = createPublicTransport({ maxBytes: 3 });
  try {
    const response = await transport.fetch("https://agent.example.invalid");
    const reader = response.body!.getReader();
    await expect(reader.read()).resolves.toEqual({
      done: false,
      value: Uint8Array.of(1, 2),
    });
    await expect(reader.read()).rejects.toThrow("远端响应超过大小限制");
  } finally {
    await transport.close();
  }
});

it("底层请求收到统一超时与调用者取消信号", async () => {
  const wire = vi.spyOn(globalThis, "fetch").mockImplementation(
    (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init!.signal!;
        if (signal.aborted) return reject(signal.reason);
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      }),
  );
  const controller = new AbortController();
  const transport = createPublicTransport({ timeoutMs: 30 });
  try {
    const pending = transport.fetch("https://agent.example.invalid", {
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toHaveProperty("name", "AbortError");
    await expect(
      transport.fetch("https://agent.example.invalid"),
    ).rejects.toHaveProperty("name", "TimeoutError");
    expect(wire).toHaveBeenCalledTimes(2);
  } finally {
    await transport.close();
  }
});
