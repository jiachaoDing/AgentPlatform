import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { createDb, type Database } from "../packages/db/src";
import { migrateDatabase } from "../packages/db/src/migrate";
import { oauthConnections, user } from "../packages/db/src/schema";
import { createHubOAuthConnections } from "../packages/api/src/hub/oauth/connections";
import {
  discoverOAuthProvider,
  type OAuthProvider,
  type OAuthRegistration,
} from "../packages/api/src/hub/oauth/provider";
import {
  connectMcp,
  createA2aClientFactory,
} from "../packages/api/src/hub/protocol-clients";
import { textMessage } from "../packages/api/test/fixtures/a2a";
import { startOAuthFixture } from "../packages/api/test/fixtures/oauth";

const alice = { userId: "oauth-user-a", sessionId: "session-a" };
const bob = { userId: "oauth-user-b", sessionId: "session-b" };
const key = randomBytes(32);
let time = Date.now();
let container: StartedPostgreSqlContainer;
let database: Database;
let fixture: Awaited<ReturnType<typeof startOAuthFixture>>;
let connections: ReturnType<typeof createHubOAuthConnections>;
const makeConnections = () =>
  createHubOAuthConnections(database, key, () => time);

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17.7-alpine").start();
  database = createDb({ DATABASE_URL: container.getConnectionUri() });
  await migrateDatabase(database);
  await database.insert(user).values(
    [alice, bob].map(({ userId }) => ({
      id: userId,
      name: userId,
      email: `${userId}@example.test`,
    })),
  );
  fixture = await startOAuthFixture();
  connections = makeConnections();
});
afterAll(async () => {
  await fixture?.close();
  await database?.$client.end();
  await container?.stop();
});

async function discover(registration: OAuthRegistration) {
  return discoverOAuthProvider(registration, fixture.fetch, async () => {});
}

async function connect(
  identity: typeof alice,
  provider: OAuthProvider,
  options?: Parameters<typeof fixture.approve>[2],
) {
  const url = await connections.start(identity, provider);
  const callback = await fixture.approve(url, identity.userId, options);
  await connections.complete(identity, provider, callback);
}

it("MCP 验证资源与 issuer，授权回调绑定用户和会话且只能并发消费一次", async () => {
  const registration = fixture.registration();
  await expect(
    discover({ ...registration, resource: `${registration.resource}/wrong` }),
  ).rejects.toThrow("无法验证远端 OAuth");
  const provider = await discover(registration);
  const before = fixture.activity.exchanges;
  const url = await connections.start(alice, provider);
  const callback = await fixture.approve(url, "alice-provider-account");
  await expect(
    connections.complete(bob, provider, callback),
  ).rejects.toHaveProperty("code", "invalid_callback");
  await expect(
    connections.complete(
      { ...alice, sessionId: "other-session" },
      provider,
      callback,
    ),
  ).rejects.toHaveProperty("code", "invalid_callback");
  expect(fixture.activity.exchanges).toBe(before);
  const attempts = await Promise.allSettled([
    connections.complete(alice, provider, callback),
    makeConnections().complete(alice, provider, callback),
  ]);
  expect(attempts.map(({ status }) => status).sort()).toEqual([
    "fulfilled",
    "rejected",
  ]);
  expect(fixture.activity.exchanges).toBe(before + 1);
  const connection = await makeConnections().summary(alice.userId, provider);
  expect(connection).toMatchObject({
    status: "connected",
    scopes: ["tools:run"],
  });
  expect(await connections.summary(bob.userId, provider)).toEqual({
    status: "disconnected",
  });
  const stored = JSON.stringify(await database.select().from(oauthConnections));
  expect(stored).not.toContain(url.searchParams.get("state"));
  for (const token of fixture.issuedTokens())
    expect(stored).not.toContain(token);
  const fetchImpl = connections.authorizedFetch(alice.userId, provider);
  const client = await connectMcp(new URL(registration.endpoint), fetchImpl);
  try {
    expect(
      (
        await client.callTool({
          name: "uppercase",
          arguments: { text: "fixture" },
        })
      ).content,
    ).toEqual([{ type: "text", text: "FIXTURE" }]);
  } finally {
    await client.close();
  }
  expect(fixture.activity.resourceRequests).toContain("alice-provider-account");
  await expect(
    connections.authorizedFetch(bob.userId, provider)(registration.endpoint),
  ).rejects.toHaveProperty("code", "reauthorize");
});

it("issuer 错误、过期回调和目标越界不会提交敏感请求", async () => {
  const registration = fixture.registration();
  const provider = await discover(registration);
  const before = fixture.activity.exchanges;
  const url = await connections.start(alice, provider);
  const callback = await fixture.approve(url, "fixture");
  callback.searchParams.set("iss", "https://wrong.example.test");
  await expect(connections.complete(alice, provider, callback)).rejects.toThrow(
    "远端 OAuth 回调无效",
  );
  const late = await fixture.approve(
    await connections.start(alice, provider),
    "fixture",
  );
  time += 10 * 60_000;
  await expect(
    connections.complete(alice, provider, late),
  ).rejects.toHaveProperty("code", "invalid_callback");
  expect(fixture.activity.exchanges).toBe(before);
  await expect(
    connections.authorizedFetch(
      alice.userId,
      provider,
    )(`${registration.endpoint}/other`),
  ).rejects.toThrow("超出已批准");
});

it("A2A 验证 Card 和实际鉴权，两个用户在同一服务上各自连接", async () => {
  const registration = fixture.registration("a2a");
  fixture.requireA2aAuth(false);
  try {
    await expect(discover(registration)).rejects.toThrow("无法验证 A2A Card");
  } finally {
    fixture.requireA2aAuth(true);
  }
  const provider = await discover(registration);
  await Promise.all([connect(alice, provider), connect(bob, provider)]);
  for (const { userId } of [alice, bob]) {
    const client = await createA2aClientFactory(
      connections.authorizedFetch(userId, provider),
    ).createFromAgentCard(fixture.card);
    expect(
      await client.sendMessage(textMessage("OAuth identity fixture")),
    ).toHaveProperty("parts.0.content.value", userId);
  }
  const otherRevision = await discover({
    ...registration,
    registrationId: "fixture-v2",
  });
  await expect(
    connections.authorizedFetch(
      alice.userId,
      otherRevision,
    )(registration.endpoint),
  ).rejects.toHaveProperty("code", "reauthorize");
  expect(
    await connections.disconnect(alice.userId, provider.serviceId, provider),
  ).toBe("revoked");
  expect(await connections.summary(alice.userId, provider)).toEqual({
    status: "disconnected",
  });
  expect(await connections.summary(bob.userId, provider)).toMatchObject({
    status: "connected",
  });
});

it("刷新轮换并持久化；没有 refresh token 或授权范围不足会拒绝执行", async () => {
  const registration = fixture.registration();
  const provider = await discover(registration);
  await connect(alice, provider);
  await connect(bob, provider, { renewable: false });
  const before = fixture.activity.refreshes;
  time += 120_000;
  const fetchAlice = connections.authorizedFetch(alice.userId, provider);
  const response = await fetchAlice(registration.endpoint);
  expect(await response.json()).toEqual({ subject: alice.userId });
  await expect(
    connections.authorizedFetch(bob.userId, provider)(registration.endpoint),
  ).rejects.toHaveProperty("code", "reauthorize");
  const restarted = makeConnections().authorizedFetch(alice.userId, provider);
  expect((await restarted(registration.endpoint)).ok).toBe(true);
  expect(fixture.activity.refreshes).toBe(before + 1);
  time += 120_000;
  expect((await restarted(registration.endpoint)).ok).toBe(true);
  expect(fixture.activity.refreshes).toBe(before + 2);

  await connect(bob, provider, { scopes: "profile:read" });
  expect(await connections.summary(bob.userId, provider)).toMatchObject({
    status: "reauthorize",
    scopes: ["profile:read"],
  });
  await expect(
    connections.authorizedFetch(bob.userId, provider)(registration.endpoint),
  ).rejects.toHaveProperty("code", "insufficient_scope");
});

it("并发刷新只提交一次，断开后拒绝后续请求且旧刷新结果不能复活连接", async () => {
  const registration = fixture.registration();
  const provider = await discover(registration);
  await connect(alice, provider);
  const before = fixture.activity.refreshes;
  const revokedBefore = fixture.revoked.length;
  time += 120_000;
  const first = connections.authorizedFetch(alice.userId, provider);
  const second = makeConnections().authorizedFetch(alice.userId, provider);
  const gate = fixture.pauseRefresh();
  const running = expect(first(registration.endpoint)).rejects.toHaveProperty(
    "code",
    "connection_changed",
  );
  try {
    await gate.arrived;
    await expect(second(registration.endpoint)).rejects.toHaveProperty(
      "code",
      "refreshing",
    );
    expect(
      await connections.disconnect(alice.userId, provider.serviceId, provider),
    ).toBe("revoked");
    await expect(second(registration.endpoint)).rejects.toHaveProperty(
      "code",
      "reauthorize",
    );
  } finally {
    gate.release();
  }
  await running;
  expect(await connections.summary(alice.userId, provider)).toEqual({
    status: "disconnected",
  });
  expect(fixture.activity.refreshes).toBe(before + 1);
  expect(fixture.revoked).toHaveLength(revokedBefore + 4);
});

it("刷新失败不会重试可能已消费的令牌，重新授权后恢复", async () => {
  const registration = fixture.registration();
  const provider = await discover(registration);
  await connect(alice, provider);
  fixture.rejectNextRefresh();
  const before = fixture.activity.refreshes;
  time += 120_000;
  await expect(
    connections.authorizedFetch(alice.userId, provider)(registration.endpoint),
  ).rejects.toHaveProperty("code", "reauthorize");
  await expect(
    makeConnections().authorizedFetch(
      alice.userId,
      provider,
    )(registration.endpoint),
  ).rejects.toHaveProperty("code", "reauthorize");
  expect(fixture.activity.refreshes).toBe(before + 1);
  const stale = await fixture.approve(
    await connections.start(alice, provider),
    "older-fixture-account",
  );
  await connect(alice, provider);
  await expect(
    connections.complete(alice, provider, stale),
  ).rejects.toHaveProperty("code", "invalid_callback");
  const response = await connections.authorizedFetch(
    alice.userId,
    provider,
  )(registration.endpoint);
  expect(await response.json()).toEqual({ subject: alice.userId });
});

it("远端拒绝现有令牌后保留 401，要求重新授权而不重放请求", async () => {
  const registration = fixture.registration();
  const provider = await discover(registration);
  const url = await connections.start(alice, provider);
  await connections.complete(
    alice,
    provider,
    await fixture.approve(url, "revoked-fixture-account"),
  );
  fixture.revokeSubject("revoked-fixture-account");
  const before = fixture.activity.refreshes;
  expect(
    (
      await connections.authorizedFetch(
        alice.userId,
        provider,
      )(registration.endpoint)
    ).status,
  ).toBe(401);
  expect(await connections.summary(alice.userId, provider)).toMatchObject({
    status: "reauthorize",
  });
  await expect(
    makeConnections().authorizedFetch(
      alice.userId,
      provider,
    )(registration.endpoint),
  ).rejects.toHaveProperty("code", "reauthorize");
  expect(fixture.activity.refreshes).toBe(before);
});
