import { existsSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

const target = fileURLToPath(new URL("../apps/server/.env", import.meta.url));
if (existsSync(target)) {
  console.log("apps/server/.env 已存在，保留现有配置。");
} else {
  const password = randomBytes(24).toString("hex");
  writeFileSync(
    target,
    [
      "NODE_ENV=development",
      "HOST=127.0.0.1",
      "PORT=3000",
      `POSTGRES_PASSWORD=${password}`,
      `DATABASE_URL=postgresql://agent_platform:${password}@127.0.0.1:55432/agent_platform`,
      "BETTER_AUTH_URL=http://127.0.0.1:3000",
      `BETTER_AUTH_SECRET=${randomBytes(32).toString("hex")}`,
      "CORS_ORIGIN=http://127.0.0.1:5173",
      "ENABLE_MARKET=true",
      "ENABLE_PLAYGROUND=true",
      "",
    ].join("\n"),
    { encoding: "utf8", flag: "wx" },
  );
  console.log("本地配置已生成，随机凭证保存在 Git 忽略的 apps/server/.env。");
}
