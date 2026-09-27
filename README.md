# Townsquare

**Proof that real people agree.**

Townsquare is a Polis-style deliberation app. People vote agree / disagree / pass on short statements,
add their own, and the app maps the opinion groups and finds what all of them agree on. On top of that it
guarantees three things that normal survey and consultation tools can't give you together:

- **One person, one voice.** You get in with a zero-knowledge gate proof (a one-time invite code, or Anon
  Aadhaar). Each credential can register once per conversation, enforced in the database and on Ethereum.
- **Nobody knows who you are.** A Semaphore proof says "I'm one of the verified members" without saying
  which one. Your votes sit under a per-conversation pseudonym that can't be traced back to you.
- **Nobody can quietly change the result.** Every action goes into a hash-chained log anchored on Base.
  Anyone can re-check the members, the votes, the math and the AI summary in their own browser.

Participants never need a wallet or gas.

> In 2017, about 18 million of the 22 million public comments sent to the US FCC were fake, and one
> 19-year-old submitted 7.7 million of them. Townsquare makes that impossible without asking anyone who they are.

Built for the EAG Global Buildathon 2026.

## How it works

```
You ──► Gate credential ──► Identity commitment ─┆─► Pseudonym (pid) ──► Votes & statements
        invite code /       member of the        ┆   one per person,       signed with a session
        Aadhaar QR          onchain Semaphore    ┆   per conversation      key bound to the pid
                            group on Base        ┆
        ZK proof made in    relayer adds it,     ┆   Semaphore proof:      every action is logged,
        your browser        nullifier recorded   ┆   "I'm one of them"     hash-chained, anchored
                                          ZK break: unlinkable
```

1. **Register.** Your browser creates a Semaphore identity for this conversation and passes the gate. The
   server checks the credential, and the relayer adds your identity commitment to the conversation's
   Semaphore group through `TownsquareHub`, recording the gate nullifier onchain so it can't be reused.
   People who register at the same moment share one `addMembers` transaction, so a full classroom is in
   within a few seconds (40 people took 4.3 s over 2 transactions on a chain with 2-second blocks).
2. **Join.** Later (ideally once more people have registered) your browser builds a Semaphore proof that
   you're in the group, bound to a fresh non-extractable WebCrypto session key. The proof's nullifier becomes
   your pseudonym. The server only accepts proofs against real group roots with at least `minMembers` people.
3. **Vote.** Each vote or statement is a small JSON payload signed with your session key. The server checks
   the signature and nonce, appends it to the log and hands back a signed receipt.
4. **Anchor.** Every 2 minutes (or 100 events) the server anchors the Merkle root of the new events and the
   chain head on Base. `TownsquareHub.anchor` only accepts contiguous batches, so there are no gaps or rewrites.
5. **Results.** The vendored Pocket Polis math (PCA, k-means, representative and consensus statements,
   bridging) runs on the log. The result hash is bound to the log position it was computed at. An AI summary
   (Groq, `gpt-oss-120b`) cites statement IDs, and any claim the numbers don't support is dropped.
6. **Seal.** The host closes the conversation: final anchor, final result, and `close(conv, finalResultHash)`
   onchain. After that nothing can change.

### Verify it yourself

`/verify/<slug>` downloads the audit bundle and reads the anchors straight from a public RPC. It runs these
checks in a Web Worker (the same code runs in the terminal with `pnpm --filter @townsquare/scripts verify`):

| Check | What it does | Catches |
|---|---|---|
| A · Membership | Every `MemberAdded` event matches a gate record, every code is in the committed code root, nullifiers are unique, group roots recompute | fake or duplicate members |
| B · Pseudonyms | Every join has a valid Semaphore proof for this conversation, bound to its session key, against a real root with at least `minMembers` leaves | invented participants |
| C · Actions | Every vote and statement verifies with its pid's current session key; nonces strictly increase | forged or replayed votes |
| D · Log integrity | Recomputes every event hash, the chain head and each batch root, and compares with `BatchAnchored` onchain | edited, deleted or reordered events |
| E · Results | Re-runs the math on the log and compares the result hash, including the onchain seal | cooked numbers |
| F · AI claims | Every summary claim cites approved statements whose numbers meet the claim's rule | hallucinated consensus |

A receipt checker shows whether your own vote made it into an anchored batch. A signed receipt for an event
that's missing or changed is public proof that the host misbehaved.

**The tamper demo:** `pnpm --filter @townsquare/scripts tamper` switches off the append-only trigger as a
database admin and flips one vote. C, D and E go red and name the exact event and batch
(`batch 3: root mismatch at seq 320`). `--restore` puts it back and everything goes green again.

### Anon Aadhaar

The Aadhaar gate runs in **test mode** in this build: participants upload a test Secure QR (from the Anon
Aadhaar test QR generator), the browser builds the proof in a Web Worker and only the proof is sent. The proof's
signal is the participant's Semaphore commitment, its nullifier seed is unique to the conversation (and part of
the config hash committed onchain), and the host can require an over-18 check that reveals nothing else. The
server and check A both re-verify the proof, the UIDAI key hash, the seed, the binding and QR freshness.

Proving is heavy: the first run downloads the ~600 MB proving key and took about 3 minutes on a laptop. For a
college event, invite codes are the practical default; Aadhaar is there for groups that need it.

## Repository

```
apps/
  server/        Express API + in-process jobs: gate, join, actions, relayer, anchoring, math, AI summary
  web/           Next.js: host wizard and dashboard, participant flow, report, verify page
packages/
  contracts/     Foundry: TownsquareHub.sol, tests, deploy script
  core/          canonical JSON (RFC 8785), hashing, hash chain, Merkle trees, P-256 signatures, schemas
  math/          vendored Pocket Polis math (MIT)
  verifier/      checks A–F and the receipt check; runs in the browser, in Node and in the server tests
scripts/         seed-demo, attack-sybil, attack-replay, tamper-db, verify, keygen
supabase/        Postgres schema: RLS on every table, append-only event log
```

## Contracts

| | Base Sepolia |
|---|---|
| Semaphore V4 (existing) | `0x8A1fd199516489B0Fb7153EB5f075cDAC83c693D` |
| TownsquareHub | [`0x138F2F75e1399a6c9C8B2A387A1C26A362AC390E`](https://sepolia.basescan.org/address/0x138F2F75e1399a6c9C8B2A387A1C26A362AC390E) |

## Run it locally

Requirements: Node 22+, pnpm 9, Postgres 16 (or a Supabase project), Foundry.

```bash
pnpm install
cp .env.example .env              # fill DATABASE_URL at least
pnpm --filter @townsquare/scripts keygen   # LOG_SIGNING_KEY and APP_NULLIFIER_SEED for .env
psql "$DATABASE_URL" -f supabase/migrations/0001_init.sql

pnpm --filter @townsquare/server dev      # API on :4000
pnpm --filter @townsquare/web dev         # web on :3000
```

Without `RELAYER_PRIVATE_KEY` and `HUB_ADDRESS` the server runs offchain: everything works except anchoring,
and `/api/meta` says so. To try the full onchain path locally, run `anvil`, deploy with
`forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast` (after pointing
`SEMAPHORE_ADDRESS` at a Semaphore deployment) and set the two variables.

Seed a demo with simulated participants, then attack it:

```bash
pnpm --filter @townsquare/scripts seed -- --people 30
pnpm --filter @townsquare/scripts attack:sybil     # 111 attempts, all rejected
pnpm --filter @townsquare/scripts attack:replay    # 23 attempts, all rejected
pnpm --filter @townsquare/scripts verify
```

### Tests

```bash
pnpm test                                    # core, math, verifier
cd packages/contracts && forge test          # contract rules, including a fuzz test on anchoring
TEST_DATABASE_URL=postgres://... pnpm --filter @townsquare/server test
```

The server test runs the whole flow against a real Postgres with real Semaphore proofs: registration,
anonymous join, key rotation, votes, anchoring, sealing, every attack in the list below, and the tamper demo.
Add `TEST_RPC_URL`, `TEST_HUB_ADDRESS` and `TEST_RELAYER_KEY` to run it onchain (Anvil works).

## Deploy

See [docs/deploy.md](docs/deploy.md): Supabase for Postgres and Realtime, one Render service for the API and
jobs, Vercel for the web app, the QuickNode faucet for Base Sepolia gas, Groq for the summary.

## Security and limits

The full threat model is in [docs/threat-model.md](docs/threat-model.md). The short version:

- One person, many accounts: one gate nullifier per credential per conversation, in the database and onchain.
- Double voting and replay: pid is the Semaphore nullifier, one vote row per (pid, statement), signed and
  strictly increasing nonces.
- Host edits votes: hash chain, contiguous onchain anchors, signed receipts.
- Linking a person to a pid: no IP logs, timestamps rounded to the minute, minimum anonymity set,
  "register now, vote later".
- Small-group inference: groups under 3 people get no published statistics.

Honest limits: the server can refuse service (a refusal after a receipt is provable, before one isn't);
pseudonymous vote vectors are public like any Polis export; invite codes are only as strong as how they're
handed out; this is for consultation, not binding elections.

## Credits

- [Pocket Polis](https://github.com/mashbean/pocket-polis) by mashbean (MIT). The opinion math in
  `packages/math` is theirs, vendored unchanged.
- [Semaphore](https://semaphore.pse.dev) and [Anon Aadhaar](https://documentation.anon-aadhaar.pse.dev), both by PSE.
- The Polis project and its research on group-aware consensus.

## License

MIT
