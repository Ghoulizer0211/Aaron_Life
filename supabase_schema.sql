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


-- ── 6. Events (Schedule tab) ──────────────────────────────────────────────────

create table if not exists events (
  id         text primary key,
  title      text not null,
  date       text,
  start_time text,
  end_time   text,
  color      text,
  category   text,
  notes      text
);


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
alter table events             disable row level security;


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
