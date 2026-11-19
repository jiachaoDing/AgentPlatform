import { beforeAll, afterAll, describe, expect, it } from "vitest";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { createDb } from "../packages/db/src";
import { createAuth } from "../packages/auth/src";
import { createHub } from "../packages/api/src/hub/service";
import { capabilities } from "../packages/db/src/schema/hub";
import { buildApp } from "../apps/server/src/app";
import { migrateDatabase } from "../packages/db/src/migrate";

let container: StartedPostgreSqlContainer;
let database: ReturnType<typeof createDb>;
let auth: ReturnType<typeof createAuth>;
let app: ReturnType<typeof buildApp>;
let userA: string;
let userB: string;
let cookieA: string;
let cookieB: string;
beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17.7-alpine").start();
  database = createDb({ DATABASE_URL: container.getConnectionUri() });
  await migrateDatabase(database);
  auth = createAuth(
    {
      BETTER_AUTH_SECRET: "test-only-secret-at-least-thirty-two-characters",
      BETTER_AUTH_URL: "http://localhost:3000",
      CORS_ORIGIN: "http://localhost:5173",
    },
    database,
  );
  for (const [email, name] of [
    ["a@example.test", "A"],
    ["b@example.test", "B"],
  ]) {
    const result = await auth.api.createUser({
      body: {
        email: email!,
        name: name!,
        password: "test-only-password-123",
        role: "user",
      },
    });
    if (name === "A") userA = result.user.id;
    else userB = result.user.id;
  }
  app = buildApp({
    origin: "http://localhost:5173",
    authUrl: "http://localhost:3000",
    authHandler: (request) => auth.handler(request),
    context: async (headers) => ({
      hub: createHub(database),
      modules: { market: false, playground: false },
      session: await auth.api.getSession({
        headers: new Headers({ cookie: String(headers.cookie ?? "") }),
      }),
    }),
  });
  for (const email of ["a@example.test", "b@example.test"]) {
    const result = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      headers: { origin: "http://localhost:5173" },
      payload: { email, password: "test-only-password-123" },
    });
    expect(result.statusCode).toBe(200);
    const cookies = result.cookies
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; ");
    if (email.startsWith("a@")) cookieA = cookies;
    else cookieB = cookies;
  }
  await database.insert(capabilities).values([
    { id: "private-a", userId: userA, name: "A 的工具", protocol: "mcp" },
    { id: "private-b", userId: userB, name: "B 的 Agent", protocol: "a2a" },
  ]);
});
afterAll(async () => {
  await app?.close();
  await database?.$client.end();
  await container?.stop();
});

describe("真实 PostgreSQL / Better Auth / Fastify / oRPC", () => {
  it("公开注册关闭且恶意来源不能登录", async () => {
    const signup = await app.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      payload: {
        email: "new@example.test",
        password: "test-only-password-123",
        name: "new",
      },
    });
    expect(signup.statusCode).toBeGreaterThanOrEqual(400);
    const foreign = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      headers: { origin: "https://foreign.example.test" },
      payload: { email: "a@example.test", password: "test-only-password-123" },
    });
    expect(foreign.statusCode).toBe(403);
  });
  it("未登录不能查询 Hub", async () => {
    const result = await app.inject({
      method: "POST",
      url: "/rpc/capabilities/list",
      payload: { json: null },
    });
    expect(result.statusCode).toBe(401);
  });
  it("两个用户只能查询自己的能力", async () => {
    const a = await app.inject({
      method: "POST",
      url: "/rpc/capabilities/list",
      headers: { cookie: cookieA, origin: "http://localhost:5173" },
      payload: { json: null },
    });
    const b = await app.inject({
      method: "POST",
      url: "/rpc/capabilities/list",
      headers: { cookie: cookieB, origin: "http://localhost:5173" },
      payload: { json: null },
    });
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(a.json().json.map((item: { id: string }) => item.id)).toEqual([
      "private-a",
    ]);
    expect(b.json().json.map((item: { id: string }) => item.id)).toEqual([
      "private-b",
    ]);
  });
  it("模块关闭时 Hub 可用，Playground 不可调用", async () => {
    const config = await app.inject({
      method: "POST",
      url: "/rpc/system",
      payload: { json: null },
    });
    expect(config.json().json).toEqual({ market: false, playground: false });
    const chat = await app.inject({
      method: "POST",
      url: "/api/chat",
      headers: { cookie: cookieA, origin: "http://localhost:5173" },
      payload: {},
    });
    expect(chat.statusCode).toBe(404);
  });
  it("用户不能自行创建组织或调用管理员用户接口", async () => {
    const organization = await app.inject({
      method: "POST",
      url: "/api/auth/organization/create",
      headers: { cookie: cookieA, origin: "http://localhost:5173" },
      payload: { name: "Unauthorized team", slug: "unauthorized" },
    });
    expect(organization.statusCode).toBeGreaterThanOrEqual(400);
    const users = await app.inject({
      method: "GET",
      url: "/api/auth/admin/list-users",
      headers: { cookie: cookieA },
    });
    expect(users.statusCode).toBeGreaterThanOrEqual(400);
  });
});
