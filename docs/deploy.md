# Deploying Townsquare

Everything runs on free tiers: Supabase (Postgres + Realtime), one Render web service (API and all jobs),
Vercel Hobby (web), Base Sepolia (chain), Groq (AI summary).

## 1. Secrets

```bash
pnpm --filter @townsquare/scripts keygen
```

Keep the printed `LOG_SIGNING_KEY` and `APP_NULLIFIER_SEED`. Create a fresh wallet for the relayer (for
example `cast wallet new`) and keep its private key. It only ever needs test ETH.

## 2. Gas

Claim Base Sepolia ETH for the relayer address. The Coinbase Developer Platform faucet
(portal.cdp.coinbase.com/products/faucet) takes any address after a login. The QuickNode faucet also works,
but only for a wallet holding at least 0.001 ETH on Ethereum mainnet, so claim there with your own wallet and
send the test ETH on to the relayer. After deploying, send one real transaction (open a test conversation) and check the gas
used in the server log (`"msg":"relayed"` lines include `gas`) so you know how many claims the pilot needs.
Local runs against a mock Semaphore used `createConversation` ~178k gas, `addMember` ~87k and `anchor` ~36k.
The real Semaphore contract updates an onchain Merkle tree, so `createConversation` and `addMember` will cost
more there; `anchor` doesn't touch Semaphore and stays the same. On the live test, 12 registrations plus
4 anchors cost about 0.000016 ETH in total. People who register while a transaction is in flight share the
next `addMembers` call, so a full room costs less per person than one-by-one sign-ups.

## 3. Contract

```bash
cd packages/contracts
export RPC_URL=https://sepolia.base.org RELAYER_PRIVATE_KEY=0x... BASESCAN_API_KEY=...
forge script script/Deploy.s.sol --rpc-url base_sepolia --broadcast --verify
```

The script deploys `TownsquareHub` pointing at Semaphore V4 (`0x8A1f…693D`) with the relayer as its only
writer. Put the printed address in `HUB_ADDRESS` and in the README.

## 4. Supabase

1. Create a project.
2. SQL editor: run `supabase/migrations/0001_init.sql`.
3. Database settings: copy the connection string (the transaction pooler on port 6543 works; the server
   disables prepared statements for it) into `DATABASE_URL`.
4. API settings: copy the project URL and the **anon** key for the web app. The service role key is not
   needed: the server talks to Postgres directly and the browser only reads `results` and `batches`.

## 5. Render (API + jobs)

New → Blueprint → this repo. `render.yaml` defines one web service. Fill the variables marked `sync: false`:
`DATABASE_URL`, `RELAYER_PRIVATE_KEY`, `HUB_ADDRESS`, `LOG_SIGNING_KEY`, `APP_NULLIFIER_SEED`, `LLM_API_KEY`
(Groq) and `WEB_ORIGIN` (the Vercel URL; comma-separate several).

The service anchors every pending event when Render sends SIGTERM on a deploy or restart. Free instances
sleep after 15 idle minutes, so during the pilot and the video recording point a free uptime pinger at
`https://<service>.onrender.com/healthz` every 10 minutes.

## 6. Vercel (web)

Import the repo, set the root directory to `apps/web` (Vercel detects pnpm and the workspace), and set:

```
NEXT_PUBLIC_API_URL=https://<service>.onrender.com
NEXT_PUBLIC_RPC_URL=https://sepolia.base.org
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

## 7. Smoke test

```bash
pnpm --filter @townsquare/scripts seed -- --api https://<service>.onrender.com --web https://<app>.vercel.app --people 12
pnpm --filter @townsquare/scripts verify
```

Open the printed report and verify links. Every check should be green and the anchors should link to
Basescan.

## Before the pilot

- `RATE_LIMIT_MULTIPLIER`: the per-connection limits already allow a class behind one campus IP; raise it
  for a big hall.
- Pick `minMembers` for the topic (10 by default, 25+ for anything sensitive).
- Print the invite code sheet from the "new conversation" page; it's only shown once.
