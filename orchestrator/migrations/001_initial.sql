-- Relocate move store (Supabase Postgres).
--
-- Applied to project `relocate` (wiivkfpvgqtfrvfjpynm) on 2026-08-26.
-- Row-level security is enabled on every table with NO policies, so the
-- public anon key can read nothing; the orchestrator writes server-side with
-- the service key. Keep it that way — these tables hold home addresses.

create table if not exists moves (
  id text primary key,
  origin_channel text not null default 'web',
  origin_address text,
  destination_address text,
  move_date text,
  user_email text,
  outbound_requests int not null default 0,
  replies_received int not null default 0,
  started_at timestamptz not null default now(),
  finalized_at timestamptz,
  final_outcome text,
  spec jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists move_specialists (
  move_id text not null references moves(id) on delete cascade,
  agent_id text not null,
  state text not null,
  terminal_outcome text,
  blocker_kind text,
  did text,
  playbook_title text,
  missing_fields text[] not null default '{}',
  artifact jsonb,
  closed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (move_id, agent_id)
);

create table if not exists move_replies (
  message_id text primary key,
  move_id text not null references moves(id) on delete cascade,
  agent_id text,
  from_address text,
  from_domain text,
  subject text,
  quote jsonb,
  received_at timestamptz not null default now()
);

create table if not exists buyer_contexts (
  call_id text primary key,
  move_id text references moves(id) on delete cascade,
  channel text,
  turn_count int not null default 0,
  dispatched boolean not null default false,
  call_ended boolean not null default false,
  collected jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists mail_ledger (
  message_id text primary key,
  direction text not null,
  move_id text,
  seen_at timestamptz not null default now()
);

create table if not exists webhook_deliveries (
  agent_id text not null,
  webhook_id text not null,
  status text not null,
  seen_at timestamptz not null default now(),
  primary key (agent_id, webhook_id)
);

create index if not exists moves_started_at_idx on moves (started_at desc);
create index if not exists moves_channel_idx on moves (origin_channel);
create index if not exists specialists_state_idx on move_specialists (state);
create index if not exists replies_move_idx on move_replies (move_id);
