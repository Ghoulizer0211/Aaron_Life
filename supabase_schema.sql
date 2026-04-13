-- ─────────────────────────────────────────────────────────────────────────────
-- Aaron Life — Complete Supabase Schema
-- Paste this entire file into Supabase → SQL Editor → Run
-- ─────────────────────────────────────────────────────────────────────────────


-- ── 1. Bank connections (one row per Teller enrollment) ──────────────────────

create table if not exists bank_connections (
  enrollment_id    text primary key,
  institution_name text,
  access_token     text,
  last_synced_at   timestamptz
);


-- ── 2. Bank accounts ─────────────────────────────────────────────────────────

create table if not exists bank_accounts (
  account_id        text primary key,
  enrollment_id     text references bank_connections (enrollment_id) on delete cascade,
  account_name      text,
  type              text,                        -- 'depository', 'credit', 'investment'
  subtype           text,                        -- 'checking', 'savings', 'credit_card', etc.
  category_group    text not null default 'cash',-- 'cash' | 'credit' | 'investments' | 'other'
  current_balance   numeric not null default 0,
  available_balance numeric not null default 0,
  last_four         text,
  institution_name  text,
  last_synced_at    timestamptz,
  source            text not null default 'teller',  -- 'teller' | 'snaptrade'
  snap_account_id   text                             -- SnapTrade's internal account ID
);


-- ── 3. Transactions ───────────────────────────────────────────────────────────

create table if not exists bank_transactions (
  transaction_id text primary key,
  account_id     text references bank_accounts (account_id) on delete cascade,
  date           date,
  description    text,
  amount         numeric,        -- positive = income, negative = spending
  category       text,           -- 'food', 'shopping', 'transport', etc.
  pending        boolean not null default false,
  is_transfer    boolean not null default false
);

-- Speeds up the monthly date-range queries the app runs on every load
create index if not exists bank_transactions_date_idx
  on bank_transactions (date desc);

create index if not exists bank_transactions_account_idx
  on bank_transactions (account_id);


-- ── 4. Daily balance snapshots (used for beginning-of-month spending calc) ───

create table if not exists balance_snapshots (
  id            bigint generated always as identity primary key,
  account_id    text references bank_accounts (account_id) on delete cascade,
  balance       numeric not null default 0,
  snapshot_date date    not null,
  unique (account_id, snapshot_date)             -- upsert key used by the server
);

create index if not exists balance_snapshots_date_idx
  on balance_snapshots (snapshot_date);


-- ── 5. Gym workouts ──────────────────────────────────────────────────────────

create table if not exists gym_workouts (
  id               uuid default gen_random_uuid() primary key,
  date             date not null,
  type             text not null,          -- Push | Pull | Legs | Full Body | Cardio | Rest
  duration_minutes integer,
  intensity        text,                   -- Light | Moderate | Heavy
  notes            text,
  exercises        jsonb default '[]'::jsonb,  -- [{name, sets:[{reps, weight}]}]
  created_at       timestamptz default now()
);

create index if not exists gym_workouts_date_idx on gym_workouts (date desc);

alter table gym_workouts disable row level security;


-- ── 6. Settings (stores PIN hash for app lock) ────────────────────────────────

create table if not exists settings (
  key   text primary key,
  value text
);


-- ── 6. Events (Schedule tab calendar) ────────────────────────────────────────
-- Hard reset: drop and recreate cleanly.

drop table if exists events cascade;

create table events (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  date       date not null,              -- YYYY-MM-DD (Pacific Time)
  start_time text,                       -- HH:MM (24-hour)
  end_time   text,                       -- HH:MM (24-hour)
  color      text,                       -- hex color string e.g. '#00e5ff'
  location   text,
  notes      text,
  done       boolean not null default false,
  created_at timestamptz default now()
);

create index if not exists events_date_idx on events (date);

alter table events disable row level security;


-- ── 7. Tasks ──────────────────────────────────────────────────────────────────
-- Hard reset: drop and recreate cleanly.

drop table if exists tasks cascade;

create table tasks (
  id               uuid primary key default gen_random_uuid(),
  title            text not null,
  priority         text not null default 'medium'   check (priority in ('high','medium','low')),
  due_date         date,                             -- optional deadline (Pacific Time)
  duration         integer not null default 60,      -- estimated minutes
  notes            text,
  done             boolean not null default false,
  done_at          timestamptz,
  checklist        jsonb not null default '[]'::jsonb,  -- [{id,text,done}]
  scheduled_date   date,                             -- date dropped onto calendar
  scheduled_start  text,                             -- HH:MM when dragged to a slot
  scheduled_end    text,                             -- HH:MM auto-computed from duration
  created_at       timestamptz default now()
);

create index if not exists tasks_created_idx   on tasks (created_at desc);
create index if not exists tasks_scheduled_idx on tasks (scheduled_date);
create index if not exists tasks_due_idx       on tasks (due_date);

alter table tasks disable row level security;


-- ── 8. Habits ─────────────────────────────────────────────────────────────────
-- Hard reset: drop and recreate cleanly.

drop table if exists habit_logs cascade;
drop table if exists habits    cascade;

create table habits (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  goal       integer not null default 7 check (goal between 1 and 7),  -- days/week target
  created_at timestamptz default now()
);

create table habit_logs (
  id         uuid primary key default gen_random_uuid(),
  habit_id   uuid not null references habits (id) on delete cascade,
  log_date   date not null,
  done       boolean not null default true,
  unique (habit_id, log_date)
);

create index if not exists habit_logs_habit_idx on habit_logs (habit_id);
create index if not exists habit_logs_date_idx  on habit_logs (log_date desc);

alter table habits     disable row level security;
alter table habit_logs disable row level security;


-- ─────────────────────────────────────────────────────────────────────────────
-- Row Level Security
--
-- This app uses the anon key from a backend server (not user auth).
-- RLS is disabled so the server's anon key can read/write freely.
-- If you ever add user accounts, re-enable RLS and add proper policies.
-- ─────────────────────────────────────────────────────────────────────────────

alter table bank_connections   disable row level security;
alter table bank_accounts      disable row level security;
alter table bank_transactions  disable row level security;
alter table balance_snapshots  disable row level security;
alter table settings           disable row level security;


-- ── Migration: add SnapTrade columns (run if table already exists) ────────────
-- Safe to run multiple times (IF NOT EXISTS / idempotent)

alter table bank_accounts add column if not exists source           text not null default 'teller';
alter table bank_accounts add column if not exists snap_account_id  text;
alter table bank_transactions add column if not exists note          text;


-- ── 7. Sleep records (Oura cache) ─────────────────────────────────────────────

create table if not exists sleep_records (
  date         date primary key,
  score        integer,
  contributors jsonb,
  total_hours  numeric,
  deep_hours   numeric,
  rem_hours    numeric,
  light_hours  numeric,
  awake_hours  numeric,
  efficiency   integer,
  latency_min  integer,
  resting_hr   integer,
  avg_hrv      numeric,
  bedtime      text,
  wake_time    text,
  synced_at    timestamptz default now()
);

alter table sleep_records disable row level security;


-- ── 8. Oura daily cache (full payload: readiness + sleep + activity) ───────────

create table if not exists oura_daily (
  date       date primary key,
  readiness  jsonb,
  sleep      jsonb,
  activity   jsonb,
  synced_at  timestamptz default now()
);

alter table oura_daily disable row level security;
