-- Priority Engine V2: goal history, confirmed semantic analysis, and audit runs.

alter table public.node_annotations
  add column if not exists priority_analysis jsonb;

create table if not exists public.goal_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  goal jsonb not null,
  status text not null default 'replaced'
    check (status in ('replaced', 'cleared')),
  replaced_at timestamptz not null default now()
);

create index if not exists idx_goal_history_user_time
  on public.goal_history(user_id, replaced_at desc);

create table if not exists public.priority_analysis_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  goal_version text,
  goal_snapshot jsonb,
  proposals jsonb not null default '[]'::jsonb,
  confirmed_payload jsonb,
  status text not null default 'proposed'
    check (status in ('proposed', 'confirmed', 'rejected')),
  model_used text,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);

create index if not exists idx_priority_analysis_runs_user_time
  on public.priority_analysis_runs(user_id, created_at desc);

alter table public.goal_history enable row level security;
alter table public.priority_analysis_runs enable row level security;

drop policy if exists "goal_history_all_own" on public.goal_history;
create policy "goal_history_all_own" on public.goal_history
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "priority_analysis_runs_all_own" on public.priority_analysis_runs;
create policy "priority_analysis_runs_all_own" on public.priority_analysis_runs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
