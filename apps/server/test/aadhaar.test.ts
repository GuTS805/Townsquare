import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { createRelayer } from "../src/chain";
import type { Ctx } from "../src/context";
import { connect } from "../src/db";
import { loadEnv } from "../src/env";
import { createJobs } from "../src/jobs";
import { createLogger } from "../src/logger";
import { loadLogKey } from "../src/logkey";

// A real Anon Aadhaar proof over a QR signed with the project's public test key.
const fixture = JSON.parse(readFileSync(new URL("./fixtures/aadhaar-test-proof.json", import.meta.url), "utf8"));
const DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!DB)("Anon Aadhaar gate", () => {
  let ctx: Ctx;
  let server: Server;
  let base: string;

  const call = async (method: string, path: string, body?: unknown, token?: string) => {
    const res = await fetch(`${base}/api${path}`, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as any };
  };

  beforeAll(async () => {
    const env = loadEnv({ DATABASE_URL: DB, NODE_ENV: "test", AADHAAR_MODE: "test" } as NodeJS.ProcessEnv);
    const log = createLogger("silent");
    let c!: Ctx;
    c = { sql: connect(env.DATABASE_URL), env, log, relayer: createRelayer(env, log), logKey: await loadLogKey(undefined), jobs: createJobs(() => c), llm: null };
    ctx = c;
    server = createApp(ctx).listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server?.close();
    await ctx?.sql.end();
  });

  it("accepts a valid proof once and rejects reuse, rebinding and the wrong gate", async () => {
    const created = await call("POST", "/conversations", {
      title: "Ward budget",
      question: "What should the ward spend on first?",
      seedStatements: ["Fix the streetlights on the main road first.", "Build a covered bus stop near the school."],
      gate: { type: "anon_aadhaar", freshnessDays: 30, reveal: ["ageAbove18"] },
      minMembers: 2,
    });
    expect(created.status).toBe(201);
    const { slug, adminToken, inviteCodes } = created.body;
    expect(inviteCodes).toEqual([]);

    // The fixture was proven for a fixed seed; point this conversation at it and relax
    // freshness so the fixture doesn't expire. Everything else is the real code path.
    await ctx.sql`update conversations set nullifier_seed = ${fixture.seed}, freshness_days = 36500 where slug = ${slug}`;
    await call("PATCH", `/conversations/${slug}`, { phase: "open" }, adminToken);

    const other = "12345678901234567890";
    expect((await call("POST", `/c/${slug}/gate/aadhaar`, { proof: fixture.proof, commitment: other })).body.code).toBe("BAD_PROOF");
    expect((await call("POST", `/c/${slug}/gate/aadhaar`, { proof: { ...fixture.proof, nullifier: "1" }, commitment: fixture.commitment })).body.code).toBe("BAD_PROOF");
    expect((await call("POST", `/c/${slug}/gate/code`, { code: "AAAAA-BBBBB", commitment: fixture.commitment })).body.code).toBe("BAD_REQUEST");

    const ok = await call("POST", `/c/${slug}/gate/aadhaar`, { proof: fixture.proof, commitment: fixture.commitment });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.memberIndex).toBe(1);

    const again = await call("POST", `/c/${slug}/gate/aadhaar`, { proof: fixture.proof, commitment: fixture.commitment });
    expect(again.body.code).toBe("GATE_NULLIFIER_USED");

    const [rec] = await ctx.sql<{ gate_type: string; nullifier: string }[]>`
      select g.gate_type, g.nullifier from gate_records g join conversations c on c.id = g.conv_id where c.slug = ${slug}`;
    expect(rec).toEqual({ gate_type: "anon_aadhaar", nullifier: fixture.proof.nullifier });
  }, 60_000);

  it("rejects a proof made for another conversation", async () => {
    const created = await call("POST", "/conversations", {
      title: "Another",
      question: "Different conversation, different seed?",
      seedStatements: ["This statement is only here to satisfy the form."],
      gate: { type: "anon_aadhaar" },
      minMembers: 2,
    });
    const r = await call("POST", `/c/${created.body.slug}/gate/aadhaar`, { proof: fixture.proof, commitment: fixture.commitment });
    expect(r.body).toMatchObject({ code: "BAD_PROOF", message: "proof was made for a different conversation" });
  });
});
