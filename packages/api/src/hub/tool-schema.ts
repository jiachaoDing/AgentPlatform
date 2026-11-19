import Ajv from "ajv";
import Ajv2020 from "ajv/dist/2020.js";
import type { JSONSchema7 } from "ai";

export function compileToolSchema(schema: JSONSchema7) {
  if (JSON.stringify(schema).length > 32_768)
    throw new Error("工具 Schema 过大");
  let nodes = 0;
  const inspect = (value: unknown, depth: number) => {
    if (++nodes > 2_000 || depth > 20) throw new Error("工具 Schema 过于复杂");
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (
        (key === "$ref" || key === "$dynamicRef") &&
        typeof child === "string" &&
        !child.startsWith("#")
      ) {
        throw new Error("工具 Schema 只能引用本地定义");
      }
      inspect(child, depth + 1);
    }
  };
  inspect(schema, 0);
  const options = {
    strict: false,
    allErrors: false,
    validateFormats: false,
    ownProperties: true,
  };
  const ajv = schema.$schema?.includes("2020-12")
    ? new Ajv2020(options)
    : new Ajv(options);
  return ajv.compile(schema);
}
