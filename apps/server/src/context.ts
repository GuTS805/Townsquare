import type { Sql } from "./db";
import type { Env } from "./env";
import type { Logger } from "./logger";
import type { LogKey } from "./logkey";
import type { Relayer } from "./chain";
import type { Jobs } from "./jobs";
import type { Llm } from "./services/ai";

export interface Ctx {
  sql: Sql;
  env: Env;
  log: Logger;
  relayer: Relayer;
  logKey: LogKey;
  jobs: Jobs;
  llm: Llm | null;
}
