import { randomUUID } from "node:crypto";
import { AgentCard, Message } from "@a2a-js/sdk";
import {
  AgentEvent,
  DefaultRequestHandler,
  InMemoryTaskStore,
  JsonRpcTransportHandler,
  ServerCallContext,
} from "@a2a-js/sdk/server";
import { calculatePKCECodeChallenge } from "oauth4webapi";
import { createMcpFixtureHandler } from "./mcp";
import { listenFixture } from "./http";

export const issuer = "https://issuer.example.test";
export const audience = "https://resource.example.test";
export const redirectUri = "https://platform.example.test/oauth/callback";
const clientId = "platform-fixture";
const scope = "tools:run";
const mcp = `${audience}/mcp`;
const a2a = `${audience}/rpc`;
const metadataUrl = `${issuer}/.well-known/oauth-authorization-server`;
type Grant = {
  subject: string;
  resource: string;
  scope: string;
  renewable: boolean;
};

export async function startOAuthFixture() {
  const authCodes = new Map<string, Grant & { challenge: string }>();
  const access = new Map<string, Grant>();
  const refresh = new Map<string, Grant>();
  const revoked: string[] = [];
  const activity = {
    exchanges: 0,
    refreshes: 0,
    resourceRequests: [] as string[],
  };
  const handler = createMcpFixtureHandler();
  let refreshGate: { arrived: () => void; release: Promise<void> } | undefined;
  let hideA2aChallenge = false;
  let rejectRefresh = false;
  const card = AgentCard.fromJSON({
    name: "Protected fixture",
    version: "1.0.0",
    description: "OAuth fixture",
    supportedInterfaces: [
      { url: a2a, protocolBinding: "JSONRPC", protocolVersion: "1.0" },
    ],
    securityRequirements: [{ schemes: { userOAuth: { list: [scope] } } }],
    securitySchemes: {
      userOAuth: {
        oauth2SecurityScheme: {
          oauth2MetadataUrl: metadataUrl,
          flows: {
            authorizationCode: {
              authorizationUrl: `${issuer}/authorize`,
              tokenUrl: `${issuer}/token`,
              scopes: { [scope]: "Run tools" },
            },
          },
        },
      },
    },
  });

  const a2aRpc = new JsonRpcTransportHandler(
    new DefaultRequestHandler(card, new InMemoryTaskStore(), {
      async execute(context, bus) {
        bus.publish(
          AgentEvent.message(
            Message.fromJSON({
              messageId: randomUUID(),
              contextId: context.contextId,
              role: "ROLE_AGENT",
              parts: [{ text: context.context.state.get("subject") }],
            }),
          ),
        );
      },
      async cancelTask() {
        throw new Error("Not supported by the fixture");
      },
    }),
  );

  function issue(grant: Grant) {
    const accessToken = `access-${randomUUID()}`;
    const refreshToken = grant.renewable
      ? `refresh-${randomUUID()}`
      : undefined;
    access.set(accessToken, grant);
    if (refreshToken) refresh.set(refreshToken, grant);
    return Response.json({
      token_type: "Bearer",
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: 120,
      scope: grant.scope,
    });
  }
  const invalid = () =>
    Response.json(
      {
        error: "invalid_grant",
        error_description: "synthetic-token-payload-not-for-client-logs",
      },
      { status: 400 },
    );

  const server = await listenFixture(async (request) => {
    const path = new URL(request.url).pathname;
    if (path === "/.well-known/oauth-authorization-server")
      return Response.json({
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        revocation_endpoint: `${issuer}/revoke`,
        code_challenge_methods_supported: ["S256"],
        authorization_response_iss_parameter_supported: true,
      });
    if (path === "/.well-known/oauth-protected-resource/mcp")
      return Response.json({ resource: mcp, authorization_servers: [issuer] });
    if (path === "/.well-known/agent-card.json")
      return Response.json(AgentCard.toJSON(card));
    if (path === "/authorize") {
      const qs = new URL(request.url).searchParams;
      const resource = qs.get("resource");
      const challenge = qs.get("code_challenge");
      if (
        !resource ||
        ![mcp, a2a].includes(resource) ||
        !challenge ||
        qs.get("client_id") !== clientId ||
        qs.get("redirect_uri") !== redirectUri ||
        qs.get("code_challenge_method") !== "S256"
      )
        return invalid();
      const code = randomUUID();
      authCodes.set(code, {
        resource,
        challenge,
        subject: qs.get("fixture_subject")!,
        scope: qs.get("fixture_scope") ?? scope,
        renewable: !qs.has("fixture_no_refresh"),
      });
      const callback = new URL(redirectUri);
      callback.search = new URLSearchParams({
        code,
        iss: issuer,
        state: qs.get("state")!,
      }).toString();
      return new Response(null, {
        status: 302,
        headers: { location: callback.href },
      });
    }
    if (path === "/token" || path === "/revoke") {
      const body = new URLSearchParams(await request.text());
      if (body.get("client_id") !== clientId || request.method !== "POST")
        return invalid();
      if (path === "/revoke") {
        const token = body.get("token")!;
        revoked.push(token);
        access.delete(token);
        refresh.delete(token);
        return new Response(null, { status: 200 });
      }
      if (body.get("grant_type") === "authorization_code") {
        activity.exchanges++;
        const code = body.get("code")!;
        const grant = authCodes.get(code);
        authCodes.delete(code);
        if (
          !grant ||
          grant.resource !== body.get("resource") ||
          body.get("redirect_uri") !== redirectUri ||
          grant.challenge !==
            (await calculatePKCECodeChallenge(body.get("code_verifier")!))
        )
          return invalid();
        return issue(grant);
      }
      if (body.get("grant_type") === "refresh_token") {
        activity.refreshes++;
        const token = body.get("refresh_token")!;
        const grant = refresh.get(token);
        refresh.delete(token);
        if (!grant || grant.resource !== body.get("resource")) return invalid();
        if (rejectRefresh) {
          rejectRefresh = false;
          return invalid();
        }
        const gate = refreshGate;
        if (gate) {
          refreshGate = undefined;
          gate.arrived();
          await gate.release;
        }
        return issue(grant);
      }
      return invalid();
    }
    if (path === "/mcp" || path === "/rpc") {
      const token = request.headers
        .get("authorization")
        ?.replace(/^Bearer /, "");
      const grant = token && access.get(token);
      if (!grant || grant.resource !== `${audience}${path}`) {
        if (path === "/rpc" && hideA2aChallenge)
          return Response.json({ error: "fixture publicly reachable" });
        return new Response(null, {
          status: 401,
          headers: { "www-authenticate": "Bearer" },
        });
      }
      activity.resourceRequests.push(grant.subject);
      if (path === "/mcp" && request.method === "POST")
        return handler.fetch(request);
      if (path === "/rpc" && request.method === "POST") {
        return Response.json(
          await a2aRpc.handle(
            await request.text(),
            new ServerCallContext({
              requestedVersion: request.headers.get("a2a-version") ?? undefined,
              state: new Map([["subject", grant.subject]]),
            }),
          ),
        );
      }
      return Response.json({ subject: grant.subject });
    }
    return new Response(null, { status: 404 });
  });

  function physicalUrl(url: URL) {
    if (![issuer, audience].includes(url.origin))
      throw new Error("Fixture origin mismatch");
    return new URL(url.pathname + url.search, server.origin);
  }
  const transport: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    return server.fetch(
      new Request(physicalUrl(new URL(request.url)), request),
    );
  };
  return {
    fetch: transport,
    close: server.close,
    activity,
    card,
    revoked,
    issuedTokens: () => [...access.keys(), ...refresh.keys()],
    requireA2aAuth(required: boolean) {
      hideA2aChallenge = !required;
    },
    revokeSubject(subject: string) {
      for (const store of [access, refresh]) {
        for (const [token, grant] of store)
          if (grant.subject === subject) store.delete(token);
      }
    },
    rejectNextRefresh() {
      rejectRefresh = true;
    },
    pauseRefresh() {
      const arrived = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      refreshGate = { arrived: arrived.resolve, release: release.promise };
      return { arrived: arrived.promise, release: release.resolve };
    },
    async approve(
      url: URL,
      subject: string,
      options: { scopes?: string; renewable?: boolean } = {},
    ) {
      const physical = physicalUrl(url);
      physical.searchParams.set("fixture_subject", subject);
      if (options.scopes)
        physical.searchParams.set("fixture_scope", options.scopes);
      if (options.renewable === false)
        physical.searchParams.set("fixture_no_refresh", "true");
      const response = await fetch(physical, {
        redirect: "manual",
        signal: AbortSignal.timeout(5_000),
      });
      if (response.status !== 302)
        throw new Error("Consent fixture did not redirect");
      return new URL(response.headers.get("location")!);
    },
    registration(protocol: "mcp" | "a2a" = "mcp") {
      const endpoint = protocol === "mcp" ? mcp : a2a;
      return {
        serviceId: randomUUID(),
        registrationId: "fixture-v1",
        protocol,
        issuer,
        resource: endpoint,
        endpoint,
        redirectUri,
        clientId,
        scopes: [scope],
      };
    },
  };
}
