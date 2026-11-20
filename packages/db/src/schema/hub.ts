import {
  pgTable,
  text,
  timestamp,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

export const capabilities = pgTable(
  "hub_capability",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    protocol: text("protocol", { enum: ["mcp", "a2a"] }).notNull(),
    description: text("description").notNull().default(""),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("hub_capability_user_idx").on(table.userId)],
);

const oauthTimestamp = (column: string) =>
  timestamp(column, { withTimezone: true });

export const oauthConnections = pgTable(
  "hub_oauth_connection",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    serviceId: text("service_id").notNull(),
    binding: text("binding").notNull(),
    authorizationId: text("authorization_id").notNull(),
    pendingSessionId: text("pending_session_id"),
    pendingVerifier: text("pending_verifier"),
    pendingExpiresAt: oauthTimestamp("pending_expires_at"),
    grantId: text("grant_id"),
    encryptedGrant: text("encrypted_grant"),
    refreshDeadline: oauthTimestamp("refresh_deadline"),
  },
  (table) => [primaryKey({ columns: [table.userId, table.serviceId] })],
);
