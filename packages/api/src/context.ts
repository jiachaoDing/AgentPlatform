import type { Session } from "@agent-platform/auth";
import type { Hub } from "./hub/service";

export type Context = {
  session: Session | null;
  hub: Hub;
  modules: { market: boolean; playground: boolean };
};
