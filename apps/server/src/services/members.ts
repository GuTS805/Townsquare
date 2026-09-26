import { Group } from "@semaphore-protocol/group";
import type { Ctx } from "../context";

// Members are appended in the same order the relayer adds them onchain (one queue),
// so leaf indexes and roots here match the Semaphore contract's.
export async function recordMember(ctx: Ctx, convId: string, commitment: string, blockNumber = 0) {
  const existing = await ctx.sql<{ commitment: string }[]>`
    select commitment from members where conv_id = ${convId} order by leaf_index`;
  const group = new Group(existing.map((m) => BigInt(m.commitment)));
  group.addMember(BigInt(commitment));
  const leafIndex = group.size - 1;
  await ctx.sql`
    insert into members (conv_id, leaf_index, commitment, root_after, size_after, block_number)
    values (${convId}, ${leafIndex}, ${commitment}, ${group.root.toString()}, ${group.size}, ${blockNumber})`;
  return { leafIndex, root: group.root.toString(), size: group.size };
}

export async function listCommitments(ctx: Ctx, convId: string): Promise<string[]> {
  const rows = await ctx.sql<{ commitment: string }[]>`
    select commitment from members where conv_id = ${convId} order by leaf_index`;
  return rows.map((r) => r.commitment);
}

export async function knownRoot(ctx: Ctx, convId: string, root: string) {
  const [row] = await ctx.sql<{ size_after: number }[]>`
    select size_after from members where conv_id = ${convId} and root_after = ${root}
    order by leaf_index desc limit 1`;
  return row ?? null;
}
