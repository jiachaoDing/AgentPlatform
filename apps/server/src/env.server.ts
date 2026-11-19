import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { z } from "zod";

config({
  path: fileURLToPath(new URL("../.env", import.meta.url)),
  quiet: true,
});
const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default("127.0.0.1"),
  DATABASE_URL: z.url(),
  BETTER_AUTH_URL: z.url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  CORS_ORIGIN: z.url(),
  ENABLE_MARKET: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  ENABLE_PLAYGROUND: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
});
const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  throw new Error(
    `环境配置缺失或无效：${parsed.error.issues.map((issue) => issue.path.join(".")).join(", ")}`,
  );
}
export const ENV = parsed.data;
