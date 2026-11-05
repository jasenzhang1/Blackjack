-- Blackjack Lab: cloud-saved stats.
-- Run once in Supabase → SQL Editor → New query → paste → Run.

-- One row per user with all progress except report cards (rules, prefs, per-cell accuracy,
-- quiz attempts, trainer stats, drills, watch stats).
create table if not exists public.user_stats (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- One row per saved session report card.
create table if not exists public.user_sessions (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null,
  report jsonb not null,
  ended bigint not null,
  primary key (user_id, id)
);

-- Row-level security: each signed-in user can only see and change their own rows.
alter table public.user_stats enable row level security;
alter table public.user_sessions enable row level security;

drop policy if exists "own stats" on public.user_stats;
create policy "own stats" on public.user_stats
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "own sessions" on public.user_sessions;
create policy "own sessions" on public.user_sessions
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.user_stats to authenticated;
grant select, insert, update, delete on public.user_sessions to authenticated;
