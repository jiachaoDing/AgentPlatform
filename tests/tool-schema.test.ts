import { describe, expect, it } from "vitest";
import { compileToolSchema } from "../packages/api/src/hub/tool-schema";

describe("MCP 参数校验", () => {
  it("校验嵌套参数且不修改用户输入", () => {
    const validate = compileToolSchema({
      type: "object",
      required: ["text"],
      additionalProperties: false,
      properties: {
        text: { type: "string", minLength: 1 },
        options: {
          type: "object",
          properties: { limit: { type: "integer", minimum: 1 } },
        },
      },
    });
    expect(validate({ text: "hello", options: { limit: 2 } })).toBe(true);
    expect(validate({ text: "hello", options: { limit: "2" } })).toBe(false);
    expect(validate({ text: "hello", injected: true })).toBe(false);
  });
  it("拒绝外部引用和过大定义", () => {
    expect(() =>
      compileToolSchema({ $ref: "https://example.invalid/schema" }),
    ).toThrow("本地定义");
    expect(() =>
      compileToolSchema({ description: "x".repeat(33_000) }),
    ).toThrow("过大");
  });
  it("支持 JSON Schema 2020-12 与本地定义", () => {
    const validate = compileToolSchema({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: { text: { $ref: "#/$defs/text" } },
      $defs: { text: { type: "string" } },
    } as Parameters<typeof compileToolSchema>[0]);
    expect(validate({ text: "hello" })).toBe(true);
    expect(validate({ text: 1 })).toBe(false);
  });
});
