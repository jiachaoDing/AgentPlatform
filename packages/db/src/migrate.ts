import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Database } from "./index";
export async function migrateDatabase(database: Database) {
  await migrate(database, {
    migrationsFolder: fileURLToPath(new URL("./migrations", import.meta.url)),
  });
}
