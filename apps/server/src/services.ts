import { createAuth } from "@agent-platform/auth";
import { createDb } from "@agent-platform/db";
import { createHub } from "@agent-platform/api/hub/service";

import { ENV } from "./env.server";

export const db = createDb(ENV);
export const auth = createAuth(ENV, db);
export const hub = createHub(db);
