import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";
config({ path: "../../apps/server/.env", quiet: true });

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./src/migrations",
  dialect: "postgresql",
  schemaFilter: ["public"],
  dbCredentials: {
    url: process.env.DATABASE_URL || "",
  },
});
