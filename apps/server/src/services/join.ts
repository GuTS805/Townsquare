import { verifyProof, type SemaphoreProof } from "@semaphore-protocol/proof";
import { TsError, importSpki, joinMessage, joinScope } from "@townsquare/core";
import { z } from "zod";
import type { Ctx } from "../context";
import type { ConversationRow } from "../db";
import { appendEvent } from "../eventlog";
import { knownRoot } from "./members";

export const joinSchema = z.object({
  proof: z.object({
    merkleTreeDepth: z.number().int().min(1).max(32),
    merkleTreeRoot: z.string().regex(/^\d+$/),
    nullifier: z.string().regex(/^\d+$/),
    message: z.string().regex(/^\d+$/),
    scope: z.string().regex(/^\d+$/),
    points: z.array(z.string()).length(8),
  }),
  sessionKey: z.string().min(40).max(200),
});

export async function join(ctx: Ctx, conv: ConversationRow, input: z.infer<typeof joinSchema>) {
  if (conv.phase !== "open") throw new TsError("WRONG_PHASE", "voting is not open");
  const { proof, sessionKey } = input;

  try {
    await importSpki(sessionKey);
  } catch {
    throw new TsError("BAD_REQUEST", "session key must be a P-256 SPKI public key");
  }

  if (proof.scope !== joinScope(conv.slug).toString()) throw new TsError("WRONG_SCOPE", "proof is for a different conversation");
  if (proof.message !== joinMessage(sessionKey).toString()) throw new TsError("KEY_NOT_BOUND", "session key not bound to proof");

  const root = await knownRoot(ctx, conv.id, proof.merkleTreeRoot);
  if (!root) throw new TsError("ROOT_UNKNOWN", "group root not known");
  if (root.size_after < conv.min_members) {
    throw new TsError("ANON_SET_TOO_SMALL", `anonymity set too small (${root.size_after} < ${conv.min_members})`);
  }

  let valid = false;
  try {
    valid = await verifyProof(proof as SemaphoreProof);
  } catch {
    valid = false;
  }
  if (!valid) throw new TsError("BAD_PROOF", "invalid Semaphore proof");

  const pid = proof.nullifier;

  return ctx.sql.begin(async (tx) => {
    const [existing] = await tx<{ key_version: number }[]>`
      select key_version from participants where conv_id = ${conv.id} and pid = ${pid} for update`;

    if (!existing) {
      const ev = await appendEvent(tx, conv.id, "JOIN", { pid, keyVersion: 1, sessionKey, proof });
      await tx`
        insert into participants (conv_id, pid, session_key_spki, key_version, last_nonce, join_seq)
        values (${conv.id}, ${pid}, ${sessionKey}, 1, 0, ${ev.seq})`;
      return { pid, keyVersion: 1, rotated: false };
    }

    // Same identity on a new device: same nullifier, new session key.
    const keyVersion = existing.key_version + 1;
    await appendEvent(tx, conv.id, "KEY_ROTATE", { pid, keyVersion, sessionKey, proof });
    await tx`
      update participants set session_key_spki = ${sessionKey}, key_version = ${keyVersion}
      where conv_id = ${conv.id} and pid = ${pid}`;
    return { pid, keyVersion, rotated: true };
  });
}
