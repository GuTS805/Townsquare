import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().default(4000),
  WEB_ORIGIN: z.string().default("http://localhost:3000"),

  DATABASE_URL: z.string().min(1),

  RPC_URL: z.string().default("https://sepolia.base.org"),
  CHAIN_ID: z.coerce.number().int().default(84532),
  RELAYER_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional().or(z.literal("").transform(() => undefined)),
  HUB_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional().or(z.literal("").transform(() => undefined)),
  SEMAPHORE_ADDRESS: z.string().default("0x8A1fd199516489B0Fb7153EB5f075cDAC83c693D"),

  LOG_SIGNING_KEY: z.string().optional(),
  APP_NULLIFIER_SEED: z.string().default("townsquare-dev-seed"),
  AADHAAR_MODE: z.enum(["test", "production"]).default("test"),

  LLM_BASE_URL: z.string().default("https://api.groq.com/openai/v1"),
  LLM_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().default("openai/gpt-oss-120b"),

  ANCHOR_INTERVAL_MS: z.coerce.number().int().default(120_000),
  ANCHOR_MAX_EVENTS: z.coerce.number().int().default(100),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`invalid environment: ${fields}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === "production") {
    if (!env.LOG_SIGNING_KEY) throw new Error("LOG_SIGNING_KEY is required in production");
    if (!env.RELAYER_PRIVATE_KEY || !env.HUB_ADDRESS) throw new Error("RELAYER_PRIVATE_KEY and HUB_ADDRESS are required in production");
  }
  return env;
}
