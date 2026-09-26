"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null | undefined;

function supabase() {
  if (client !== undefined) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  client = url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
  return client;
}

// The anon key can only read `results` and `batches` (RLS). Any change there is a cue to refetch
// from the API; the payload itself is not trusted or used.
export function subscribeToResults(onChange: () => void): (() => void) | null {
  const sb = supabase();
  if (!sb) return null;
  const channel = sb
    .channel(`results-${Math.random().toString(36).slice(2)}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "results" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "batches" }, onChange)
    .subscribe();
  return () => void sb.removeChannel(channel);
}
