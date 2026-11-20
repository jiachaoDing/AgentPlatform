import type { Database } from "@agent-platform/db";
import { createPublicTransport } from "../../network/public-fetch";
import { createHubOAuthConnections } from "./connections";
import { discoverOAuthProvider, type OAuthRegistration } from "./provider";

// Server-only composition root for approved registrations and user connections.
export function openHubOAuth(database: Database, key: Uint8Array) {
  const connections = createHubOAuthConnections(database, key);
  const transport = createPublicTransport();
  return {
    connections,
    discover: (registration: OAuthRegistration) =>
      discoverOAuthProvider(registration, transport.fetch),
    close: transport.close,
  };
}
