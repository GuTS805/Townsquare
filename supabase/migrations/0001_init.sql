-- Townsquare schema.
-- All writes go through the server with the service key; the browser never writes.
-- RLS is on for every table. Only results and batches are readable by anon,
-- so the live report can subscribe to them over Supabase Realtime.

create table conversations (
  id               uuid primary key default gen_random_uuid(),
  slug             text not null unique,
  title            text not null,
  question         text not null,
  context          text not null default '',
  gate_type        text not null check (gate_type in ('invite_code', 'anon_aadhaar')),
  nullifier_seed   text,
  code_root        text,
  freshness_days   int  not null default 30,
  reveal           text[] not null default '{}',
  min_members      int  not null default 10 check (min_members >= 2),
  moderation       text not null default 'post' check (moderation in ('pre', 'post')),
  phase            text not null default 'draft' check (phase in ('draft', 'open', 'closed', 'sealed')),
  opens_at         timestamptz,
  closes_at        timestamptz,
  chain_conv_id    numeric(78, 0) unique,
  group_id         numeric(78, 0),
  create_tx        text,
  config_hash      text not null,
  admin_token_hash text not null,
  final_result_hash text,
  -- counters handed out inside the same transaction that writes the event
  next_seq         bigint not null default 1,
  next_sid         int    not null default 1,
  created_at       timestamptz not null default date_trunc('minute', now())
);

create table gate_records (
  id          bigint generated always as identity primary key,
  conv_id     uuid not null references conversations (id),
  gate_type   text not null check (gate_type in ('invite_code', 'anon_aadhaar')),
  nullifier   text not null,
  commitment  text not null,
  proof       jsonb,
  proof_hash  text not null,
  tx_hash     text,
  t           timestamptz not null default date_trunc('minute', now()),
  unique (conv_id, nullifier),
  unique (conv_id, commitment)
);

create table invite_codes (
  conv_id    uuid not null references conversations (id),
  code_hash  text not null,
  used_at    timestamptz,
  primary key (conv_id, code_hash)
);

-- mirrored from MemberAdded / Semaphore events by the indexer
create table members (
  conv_id      uuid not null references conversations (id),
  leaf_index   int  not null,
  commitment   text not null,
  root_after   text not null,
  size_after   int  not null,
  block_number bigint not null,
  primary key (conv_id, leaf_index)
);

create index members_root_idx on members (conv_id, root_after);

create table participants (
  conv_id          uuid not null references conversations (id),
  pid              text not null,
  session_key_spki text not null,
  key_version      int  not null default 1,
  last_nonce       bigint not null default 0,
  join_seq         bigint not null,
  primary key (conv_id, pid)
);

create table statements (
  conv_id     uuid not null references conversations (id),
  sid         int  not null,
  text        text not null check (char_length(text) between 10 and 140),
  author_pid  text,
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reason_code text,
  seq         bigint,
  primary key (conv_id, sid),
  unique (conv_id, text)
);

create table votes (
  conv_id uuid     not null references conversations (id),
  pid     text     not null,
  sid     int      not null,
  value   smallint not null check (value in (-1, 0, 1)),
  seq     bigint   not null,
  primary key (conv_id, pid, sid),
  foreign key (conv_id, sid) references statements (conv_id, sid)
);

-- Append-only. Which batch an event belongs to is derived from batches.from_seq..to_seq,
-- so nothing ever needs to update a row here.
create table events (
  conv_id    uuid   not null references conversations (id),
  seq        bigint not null check (seq >= 1),
  type       text   not null check (type in ('PHASE', 'JOIN', 'KEY_ROTATE', 'STATEMENT', 'MODERATE', 'VOTE')),
  body       jsonb  not null,
  sig        text,
  event_hash text   not null,
  chain_head text   not null,
  t          timestamptz not null default date_trunc('minute', now()),
  primary key (conv_id, seq)
);

create function events_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'events is append-only (% blocked)', tg_op;
end;
$$;

create trigger events_no_update before update on events
  for each row execute function events_append_only();
create trigger events_no_delete before delete on events
  for each row execute function events_append_only();
create trigger events_no_truncate before truncate on events
  for each statement execute function events_append_only();

create table batches (
  conv_id   uuid   not null references conversations (id),
  batch_id  int    not null,
  from_seq  bigint not null,
  to_seq    bigint not null,
  root      text   not null,
  head      text   not null,
  tx_hash   text,
  status    text   not null default 'pending' check (status in ('pending', 'sent', 'confirmed', 'failed')),
  created_at timestamptz not null default date_trunc('minute', now()),
  primary key (conv_id, batch_id),
  unique (conv_id, from_seq),
  check (to_seq >= from_seq)
);

create table results (
  id          bigint generated always as identity primary key,
  conv_id     uuid   not null references conversations (id),
  at_seq      bigint not null,
  math        jsonb  not null,
  result_hash text   not null,
  synthesis   jsonb,
  model       text,
  prompt_hash text,
  params      jsonb,
  created_at  timestamptz not null default date_trunc('minute', now())
);

create index results_latest_idx on results (conv_id, id desc);

alter table conversations enable row level security;
alter table gate_records  enable row level security;
alter table invite_codes  enable row level security;
alter table members       enable row level security;
alter table participants  enable row level security;
alter table statements    enable row level security;
alter table votes         enable row level security;
alter table events        enable row level security;
alter table batches       enable row level security;
alter table results       enable row level security;

create policy results_public_read on results for select to anon using (true);
create policy batches_public_read on batches for select to anon using (true);

alter publication supabase_realtime add table results, batches;
