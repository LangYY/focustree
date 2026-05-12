-- ════════════════════════════════════════════════════════════════
-- 用户战略画像表（user_profile）
-- 第一阶段只用 current_goal，其他字段先留空，留出演化空间
-- ════════════════════════════════════════════════════════════════

create table if not exists public.user_profile (
  user_id uuid primary key references auth.users(id) on delete cascade,

  -- 当前阶段目标 {text, set_at, expires_at, constraints, exclude}
  current_goal jsonb,

  -- 性格画像（第三阶段启用，先留空）
  personality jsonb default '{}'::jsonb,

  -- AI 学到的用户模式（第三阶段启用，先留空）
  learned_patterns jsonb default '[]'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 自动维护 updated_at
create or replace function public.touch_user_profile()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_touch_user_profile on public.user_profile;
create trigger trg_touch_user_profile
  before update on public.user_profile
  for each row execute function public.touch_user_profile();

-- ════════════════════════════════════════════════════════════════
-- Row Level Security
-- ════════════════════════════════════════════════════════════════

alter table public.user_profile enable row level security;

drop policy if exists "user_profile_select_own" on public.user_profile;
create policy "user_profile_select_own" on public.user_profile
  for select using (auth.uid() = user_id);

drop policy if exists "user_profile_insert_own" on public.user_profile;
create policy "user_profile_insert_own" on public.user_profile
  for insert with check (auth.uid() = user_id);

drop policy if exists "user_profile_update_own" on public.user_profile;
create policy "user_profile_update_own" on public.user_profile
  for update using (auth.uid() = user_id);

drop policy if exists "user_profile_delete_own" on public.user_profile;
create policy "user_profile_delete_own" on public.user_profile
  for delete using (auth.uid() = user_id);
