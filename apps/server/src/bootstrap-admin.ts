import { z } from "zod";
import { auth, db } from "./services";

const input = z
  .object({
    ADMIN_EMAIL: z.email(),
    ADMIN_NAME: z.string().min(1),
    ADMIN_PASSWORD: z.string().min(12),
  })
  .safeParse(process.env);
if (!input.success)
  throw new Error(
    "请设置 ADMIN_EMAIL、ADMIN_NAME 和至少 12 位的 ADMIN_PASSWORD",
  );
const connection = await db.$client.connect();
try {
  await connection.query("SELECT pg_advisory_lock(73815001)");
  const existing = await connection.query('SELECT id FROM "user" LIMIT 1');
  if (existing.rowCount)
    throw new Error("平台已有账号，请由现有管理员管理用户");
  await auth.api.createUser({
    body: {
      email: input.data.ADMIN_EMAIL,
      name: input.data.ADMIN_NAME,
      password: input.data.ADMIN_PASSWORD,
      role: "admin",
    },
  });
  console.log("初始管理员已创建");
} finally {
  await connection.query("SELECT pg_advisory_unlock(73815001)");
  connection.release();
  await db.$client.end();
}
