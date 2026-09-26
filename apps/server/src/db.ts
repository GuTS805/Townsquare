import postgres from "postgres";

export type Sql = postgres.Sql;
export type Tx = postgres.TransactionSql;

export function connect(url: string): Sql {
  return postgres(url, {
    max: 10,
    // Supabase's transaction pooler doesn't support prepared statements
    prepare: false,
    types: {
      // numeric(78,0) holds uint256 values; keep them as strings
      numeric: { to: 1700, from: [1700], serialize: (v: string) => v, parse: (v: string) => v },
      bigint: { to: 20, from: [20], serialize: (v: number | bigint) => String(v), parse: (v: string) => Number(v) },
    },
  });
}

export interface ConversationRow {
  id: string;
  slug: string;
  title: string;
  question: string;
  context: string;
  gate_type: "invite_code" | "anon_aadhaar";
  nullifier_seed: string | null;
  code_root: string | null;
  freshness_days: number;
  reveal: string[];
  min_members: number;
  moderation: "pre" | "post";
  phase: "draft" | "open" | "closed" | "sealed";
  chain_conv_id: string | null;
  group_id: string | null;
  create_tx: string | null;
  config_hash: string;
  admin_token_hash: string;
  final_result_hash: string | null;
  next_seq: number;
  next_sid: number;
  created_at: Date;
}
