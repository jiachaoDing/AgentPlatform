import { createHash } from "node:crypto";
import { verifyA2aOAuth } from "./a2a-binding";
import * as oauth from "oauth4webapi";
import { discoverOAuthProtectedResourceMetadata } from "@modelcontextprotocol/client";
import {
  parsePublicUrl,
  validatePublicDestination,
} from "../../network/public-fetch";

export type OAuthRegistration = {
  serviceId: string;
  // Revision of a server-approved registration, including its client credential.
  registrationId: string;
  protocol: "mcp" | "a2a";
  issuer: string;
  resource: string;
  endpoint: string;
  redirectUri: string;
  clientId: string;
  clientSecret?: string;
  scopes: string[];
  resourceMetadataUrl?: string;
};

export type OAuthGrant = {
  accessToken: string;
  refreshToken?: string;
  scopes: string[];
  expiresAt: number | null;
};

export type OAuthProvider = Readonly<{
  serviceId: string;
  binding: string;
  scopes: readonly string[];
  authorize(state: string, verifier: string): Promise<URL>;
  exchange(
    callback: URL,
    state: string,
    verifier: string,
    now: number,
  ): Promise<OAuthGrant>;
  refresh(previous: OAuthGrant, now: number): Promise<OAuthGrant>;
  revoke(grant: OAuthGrant): Promise<"revoked" | "unsupported" | "failed">;
  prepareRequest(input: Request | URL | string, init?: RequestInit): Request;
  request(request: Request, accessToken: string): Promise<Response>;
}>;

const unique = (values: string[]) => [...new Set(values)].sort();
const scopeToken = /^[\x21\x23-\x5b\x5d-\x7e]+$/;

function parseGrant(
  result: oauth.TokenEndpointResponse,
  scopes: string[],
  now: number,
  previous?: OAuthGrant,
): OAuthGrant {
  if (
    result.token_type !== "bearer" ||
    !/^[A-Za-z0-9\-._~+/]+=*$/.test(result.access_token)
  ) {
    throw new Error("远端服务未返回可用的 Bearer 令牌");
  }
  const granted =
    result.scope === undefined
      ? scopes
      : unique(result.scope.split(" ").filter(Boolean));
  if (
    granted.some(
      (scope) =>
        !scopeToken.test(scope) || (previous && !scopes.includes(scope)),
    )
  ) {
    throw new Error("远端服务返回了无效的 OAuth 权限范围");
  }
  const expiresAt =
    result.expires_in === undefined ? null : now + result.expires_in * 1_000;
  if (expiresAt !== null && !Number.isSafeInteger(expiresAt))
    throw new Error("远端 OAuth 的有效期无效");
  return {
    accessToken: result.access_token,
    refreshToken: result.refresh_token ?? previous?.refreshToken,
    scopes: granted,
    expiresAt,
  };
}

function approvedEndpoint(value: string | undefined, origin: string) {
  if (!value) throw new Error("远端 OAuth 端点缺失");
  const url = parsePublicUrl(value);
  if (url.origin !== origin)
    throw new Error("远端 OAuth 端点不在已批准的 issuer 来源");
  return url;
}

export async function discoverOAuthProvider(
  registration: OAuthRegistration,
  fetchImpl: typeof fetch,
  checkBrowserTarget = validatePublicDestination,
): Promise<OAuthProvider> {
  const { serviceId, registrationId, protocol, clientId, clientSecret } =
    registration;
  const issuer = parsePublicUrl(registration.issuer);
  const resource = parsePublicUrl(registration.resource);
  const endpoint = parsePublicUrl(registration.endpoint);
  const redirect = parsePublicUrl(registration.redirectUri);
  const scopes = unique(registration.scopes);
  if (
    !serviceId ||
    !registrationId ||
    !clientId ||
    issuer.search ||
    redirect.search ||
    endpoint.origin !== resource.origin ||
    scopes.some((scope) => !scopeToken.test(scope))
  ) {
    throw new Error("远端 OAuth 登记无效");
  }
  const restrictedFetch: typeof fetch = (input, init) =>
    fetchImpl(input, { ...init, redirect: "error" });
  let as: oauth.AuthorizationServer;
  let metadataUrl: URL | undefined;
  try {
    if (protocol === "mcp") {
      const metadata = await discoverOAuthProtectedResourceMetadata(
        endpoint,
        {
          resourceMetadataUrl: registration.resourceMetadataUrl
            ? approvedEndpoint(
                registration.resourceMetadataUrl,
                resource.origin,
              )
            : undefined,
        },
        restrictedFetch,
      );
      if (
        new URL(metadata.resource).href !== resource.href ||
        !metadata.authorization_servers?.some(
          (candidate) => new URL(candidate).href === issuer.href,
        )
      ) {
        throw new Error("MCP resource and issuer mismatch");
      }
    }
    as = await oauth.processDiscoveryResponse(
      issuer,
      await oauth.discoveryRequest(issuer, {
        algorithm: "oauth2",
        [oauth.customFetch]: (url, init) => {
          metadataUrl = new URL(url);
          return restrictedFetch(url, init);
        },
      }),
    );
  } catch {
    throw new Error("无法验证远端 OAuth 资源与授权服务器");
  }
  const authorization = approvedEndpoint(
    as.authorization_endpoint,
    issuer.origin,
  );
  const token = approvedEndpoint(as.token_endpoint, issuer.origin);
  const revocation = as.revocation_endpoint
    ? approvedEndpoint(as.revocation_endpoint, issuer.origin)
    : undefined;
  if (
    as.authorization_response_iss_parameter_supported !== true ||
    !Array.isArray(as.code_challenge_methods_supported) ||
    !as.code_challenge_methods_supported.includes("S256")
  ) {
    throw new Error("远端 OAuth 必须支持 S256 PKCE 与授权响应 issuer 校验");
  }
  if (protocol === "a2a") {
    try {
      if (!metadataUrl) throw new Error("Missing issuer metadata URL");
      await verifyA2aOAuth(
        endpoint,
        metadataUrl,
        authorization,
        token,
        scopes,
        restrictedFetch,
      );
    } catch {
      throw new Error("无法验证 A2A Card 的 OAuth 声明与远端授权行为");
    }
  }
  const client: oauth.Client = { client_id: clientId };
  const clientAuth = clientSecret
    ? oauth.ClientSecretBasic(clientSecret)
    : oauth.None();
  const binding = createHash("sha256")
    .update(
      JSON.stringify([
        registrationId,
        protocol,
        clientId,
        Boolean(clientSecret),
        as.issuer,
        resource.href,
        endpoint.href,
        redirect.href,
        scopes,
        authorization.href,
        token.href,
        revocation?.href,
      ]),
    )
    .digest("hex");
  const options = {
    [oauth.customFetch]: restrictedFetch,
    additionalParameters: { resource: resource.href },
  };

  function checkResourceRequest(request: Request) {
    if (
      request.url !== endpoint.href ||
      ["authorization", "proxy-authorization", "host", "cookie"].some((name) =>
        request.headers.has(name),
      )
    ) {
      throw new Error("远端 OAuth 请求超出已批准的目标或凭证范围");
    }
  }

  return {
    serviceId,
    binding,
    scopes: Object.freeze(scopes),
    async authorize(state: string, verifier: string) {
      const url = new URL(authorization);
      await checkBrowserTarget(url);
      for (const [key, value] of Object.entries({
        response_type: "code",
        client_id: clientId,
        redirect_uri: redirect.href,
        resource: resource.href,
        state,
        code_challenge_method: "S256",
        code_challenge: await oauth.calculatePKCECodeChallenge(verifier),
      }))
        url.searchParams.set(key, value);
      if (scopes.length > 0) url.searchParams.set("scope", scopes.join(" "));
      else url.searchParams.delete("scope");
      return url;
    },
    async exchange(
      callback: URL,
      state: string,
      verifier: string,
      now: number,
    ) {
      try {
        const location = parsePublicUrl(callback);
        location.search = "";
        if (location.href !== redirect.href)
          throw new Error("Callback target mismatch");
        const params = oauth.validateAuthResponse(as, client, callback, state);
        const response = await oauth.authorizationCodeGrantRequest(
          as,
          client,
          clientAuth,
          params,
          redirect.href,
          verifier,
          options,
        );
        return parseGrant(
          await oauth.processAuthorizationCodeResponse(as, client, response),
          scopes,
          now,
        );
      } catch {
        throw new Error("远端 OAuth 回调无效或令牌交换失败");
      }
    },
    async refresh(previous: OAuthGrant, now: number) {
      try {
        if (!previous.refreshToken) throw new Error("No refresh token");
        const response = await oauth.refreshTokenGrantRequest(
          as,
          client,
          clientAuth,
          previous.refreshToken,
          options,
        );
        return parseGrant(
          await oauth.processRefreshTokenResponse(as, client, response),
          previous.scopes,
          now,
          previous,
        );
      } catch {
        throw new Error("远端 OAuth 刷新失败，请重新授权");
      }
    },
    async revoke(grant: OAuthGrant) {
      if (!revocation) return "unsupported" as const;
      async function revoke(
        token: string,
        type: "access_token" | "refresh_token",
      ) {
        const response = await oauth.revocationRequest(
          as,
          client,
          clientAuth,
          token,
          {
            [oauth.customFetch]: restrictedFetch,
            additionalParameters: { token_type_hint: type },
          },
        );
        await oauth.processRevocationResponse(response);
      }
      const results = await Promise.allSettled([
        ...(grant.refreshToken
          ? [revoke(grant.refreshToken, "refresh_token")]
          : []),
        revoke(grant.accessToken, "access_token"),
      ]);
      return results.every(({ status }) => status === "fulfilled")
        ? ("revoked" as const)
        : ("failed" as const);
    },
    // Validate before looking up or refreshing a token. Only the exact approved
    // protocol endpoint receives the credential, never a Card-provided alternative.
    prepareRequest(input: Request | URL | string, init?: RequestInit) {
      const request = new Request(input, init);
      checkResourceRequest(request);
      return request;
    },
    request(request: Request, accessToken: string) {
      checkResourceRequest(request);
      const headers = new Headers(request.headers);
      headers.set("authorization", `Bearer ${accessToken}`);
      return restrictedFetch(request, { headers });
    },
  };
}
