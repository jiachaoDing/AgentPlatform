import { createHash, randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { generateRandomCodeVerifier, generateRandomState } from "oauth4webapi";
import type { Database } from "@agent-platform/db";
import { oauthConnections as rows } from "@agent-platform/db/schema/hub";
import { createCredentialVault } from "./vault";
import type { OAuthGrant, OAuthProvider } from "./provider";

type Identity = { userId: string; sessionId: string };
type Row = typeof rows.$inferSelect;
type RevokeStatus = "revoked" | "unsupported" | "failed" | "not_needed";
const pendingLifetime = 10 * 60_000;
const refreshWindow = 60_000;
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const connection = (userId: string, serviceId: string) =>
  and(eq(rows.userId, userId), eq(rows.serviceId, serviceId));
const bound = (userId: string, provider: OAuthProvider) =>
  and(
    connection(userId, provider.serviceId),
    eq(rows.binding, provider.binding),
  );
const coordinates = (
  owner: Pick<Row, "userId" | "serviceId" | "binding">,
  purpose: string,
  id: string,
) => [owner.userId, owner.serviceId, owner.binding, purpose, id];

export class OAuthConnectionError extends Error {
  constructor(
    readonly code:
      | "invalid_callback"
      | "reauthorize"
      | "refreshing"
      | "insufficient_scope"
      | "connection_changed",
  ) {
    super(code);
  }
}

// The caller supplies a provider from the verified service registry, never from
// browser input. Access to a capability and its specific action is checked by Hub.
export function createHubOAuthConnections(
  database: Database,
  key: Uint8Array,
  now = Date.now,
) {
  const vault = createCredentialVault(key);
  const owner = (userId: string, provider: OAuthProvider) => ({
    userId,
    serviceId: provider.serviceId,
    binding: provider.binding,
  });

  function openGrant(row: Row): OAuthGrant | undefined {
    if (!row.encryptedGrant || !row.grantId) return;
    return JSON.parse(
      vault.open(row.encryptedGrant, coordinates(row, "grant", row.grantId)),
    ) as OAuthGrant;
  }

  function sealGrant(
    userId: string,
    provider: OAuthProvider,
    grant: OAuthGrant,
  ) {
    const grantId = randomUUID();
    return {
      grantId,
      encryptedGrant: vault.seal(
        JSON.stringify(grant),
        coordinates(owner(userId, provider), "grant", grantId),
      ),
      refreshDeadline: null,
    };
  }

  async function discardGrantIfDisconnected(
    userId: string,
    provider: OAuthProvider,
    grant: OAuthGrant,
  ) {
    const [existing] = await database
      .select({ userId: rows.userId })
      .from(rows)
      .where(connection(userId, provider.serviceId));
    // Don't revoke when another authorization now owns this registration; some
    // providers apply revocation to the entire grant rather than one token.
    if (!existing) await provider.revoke(grant);
  }

  function checkScopes(grant: OAuthGrant, provider: OAuthProvider) {
    if (provider.scopes.some((scope) => !grant.scopes.includes(scope))) {
      throw new OAuthConnectionError("insufficient_scope");
    }
  }

  async function accessToken(userId: string, provider: OAuthProvider) {
    const target = bound(userId, provider);
    const [row] = await database.select().from(rows).where(target);
    const grant = row && openGrant(row);
    if (!row || !grant || !row.grantId)
      throw new OAuthConnectionError("reauthorize");
    checkScopes(grant, provider);
    if (row.refreshDeadline) {
      throw new OAuthConnectionError(
        row.refreshDeadline.getTime() > now() ? "refreshing" : "reauthorize",
      );
    }
    if (grant.expiresAt === null || grant.expiresAt > now())
      return { accessToken: grant.accessToken, grantId: row.grantId };
    if (!grant.refreshToken) throw new OAuthConnectionError("reauthorize");
    const generation = and(target, eq(rows.grantId, row.grantId));
    const deadline = new Date(now() + refreshWindow);
    const claim = and(generation, eq(rows.refreshDeadline, deadline));
    const [claimed] = await database
      .update(rows)
      .set({ refreshDeadline: deadline })
      .where(and(generation, isNull(rows.refreshDeadline)))
      .returning({ userId: rows.userId });
    if (!claimed) throw new OAuthConnectionError("connection_changed");

    let updated: OAuthGrant;
    try {
      updated = await provider.refresh(grant, now());
    } catch {
      // A rotating refresh token may already have been consumed remotely.
      // Expiring the claim requires a new authorization, never another refresh.
      await database
        .update(rows)
        .set({ refreshDeadline: new Date(now()) })
        .where(claim);
      throw new OAuthConnectionError("reauthorize");
    }
    const sealed = sealGrant(userId, provider, updated);
    const [saved] = await database
      .update(rows)
      .set(sealed)
      .where(claim)
      .returning({ userId: rows.userId });
    if (!saved) {
      await discardGrantIfDisconnected(userId, provider, updated);
      throw new OAuthConnectionError("connection_changed");
    }
    checkScopes(updated, provider);
    if (updated.expiresAt !== null && updated.expiresAt <= now())
      throw new OAuthConnectionError("reauthorize");
    return { accessToken: updated.accessToken, grantId: sealed.grantId };
  }

  return {
    async start(identity: Identity, provider: OAuthProvider) {
      const state = generateRandomState();
      const verifier = generateRandomCodeVerifier();
      const url = await provider.authorize(state, verifier);
      const authorizationId = digest(state);
      const claim = {
        ...owner(identity.userId, provider),
        authorizationId,
        pendingSessionId: identity.sessionId,
        pendingVerifier: vault.seal(
          verifier,
          coordinates(
            owner(identity.userId, provider),
            "pkce",
            authorizationId,
          ),
        ),
        pendingExpiresAt: new Date(now() + pendingLifetime),
      };
      await database.transaction(async (tx) => {
        const [created] = await tx
          .insert(rows)
          .values(claim)
          .onConflictDoNothing()
          .returning({ userId: rows.userId });
        if (created) return;
        const target = connection(identity.userId, provider.serviceId);
        const [previous] = await tx
          .select({ binding: rows.binding })
          .from(rows)
          .where(target)
          .for("update");
        if (!previous) throw new OAuthConnectionError("connection_changed");
        await tx
          .update(rows)
          .set({
            ...claim,
            ...(previous.binding === provider.binding
              ? {}
              : { encryptedGrant: null, grantId: null, refreshDeadline: null }),
          })
          .where(target);
      });
      return url;
    },

    async complete(identity: Identity, provider: OAuthProvider, callback: URL) {
      const states = callback.searchParams.getAll("state");
      const state = states[0];
      if (states.length !== 1 || !state || !/^[A-Za-z0-9_-]{43}$/.test(state)) {
        throw new OAuthConnectionError("invalid_callback");
      }
      const authorizationId = digest(state);
      const target = and(
        bound(identity.userId, provider),
        eq(rows.authorizationId, authorizationId),
      );
      const verifier = await database.transaction(async (tx) => {
        const [pending] = await tx
          .select()
          .from(rows)
          .where(target)
          .for("update");
        if (
          !pending?.pendingVerifier ||
          pending.pendingSessionId !== identity.sessionId ||
          !pending.pendingExpiresAt ||
          pending.pendingExpiresAt.getTime() <= now()
        ) {
          throw new OAuthConnectionError("invalid_callback");
        }
        await tx
          .update(rows)
          .set({
            pendingVerifier: null,
            pendingSessionId: null,
            pendingExpiresAt: null,
          })
          .where(target);
        return vault.open(
          pending.pendingVerifier,
          coordinates(pending, "pkce", authorizationId),
        );
      });
      const grant = await provider.exchange(callback, state, verifier, now());
      const [saved] = await database
        .update(rows)
        .set(sealGrant(identity.userId, provider, grant))
        .where(target)
        .returning({ userId: rows.userId });
      if (!saved) {
        await discardGrantIfDisconnected(identity.userId, provider, grant);
        throw new OAuthConnectionError("connection_changed");
      }
    },

    async summary(userId: string, provider: OAuthProvider) {
      const [row] = await database
        .select()
        .from(rows)
        .where(connection(userId, provider.serviceId));
      if (!row) return { status: "disconnected" as const };
      if (row.binding !== provider.binding)
        return { status: "reauthorize" as const };
      const grant = openGrant(row);
      if (!grant) {
        return {
          status:
            row.pendingExpiresAt && row.pendingExpiresAt.getTime() > now()
              ? ("pending" as const)
              : ("reauthorize" as const),
        };
      }
      const expired = grant.expiresAt !== null && grant.expiresAt <= now();
      const status =
        row.refreshDeadline && row.refreshDeadline.getTime() > now()
          ? ("refreshing" as const)
          : row.refreshDeadline ||
              (expired && !grant.refreshToken) ||
              provider.scopes.some((scope) => !grant.scopes.includes(scope))
            ? ("reauthorize" as const)
            : ("connected" as const);
      return { status, scopes: grant.scopes, expiresAt: grant.expiresAt };
    },

    authorizedFetch(userId: string, provider: OAuthProvider): typeof fetch {
      return async (input, init) => {
        const request = provider.prepareRequest(input, init);
        request.signal.throwIfAborted();
        const grant = await accessToken(userId, provider);
        request.signal.throwIfAborted();
        const response = await provider.request(request, grant.accessToken);
        if (response.status === 401) {
          // Do not repeat an operation after remote revocation. Invalidate only
          // the generation the resource actually rejected.
          await database
            .update(rows)
            .set({ refreshDeadline: new Date(now()) })
            .where(
              and(bound(userId, provider), eq(rows.grantId, grant.grantId)),
            );
        }
        return response;
      };
    },

    async disconnect(
      userId: string,
      serviceId: string,
      provider?: OAuthProvider,
    ): Promise<RevokeStatus> {
      const [old] = await database
        .delete(rows)
        .where(connection(userId, serviceId))
        .returning();
      if (!old?.encryptedGrant) return "not_needed";
      if (
        !provider ||
        provider.serviceId !== serviceId ||
        old.binding !== provider.binding
      )
        return "unsupported";
      try {
        const grant = openGrant(old);
        return grant ? await provider.revoke(grant) : "failed";
      } catch {
        return "failed";
      }
    },
  };
}
