-- ════════════════════════════════════════════════════════════════
-- Phase 5.3 · 周末主动回顾
-- 每周每个用户最多一条（unique user_id + week_start）
-- ════════════════════════════════════════════════════════════════

create table if not exists public.weekly_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  -- 这次 review 覆盖的周（用周一作为 week_start）
  week_start date not null,
  week_end date not null,

  -- AI 生成的回顾文本
  summary text not null,
  -- 结构化指标快照：{completed_count, dropped_count, hit_rate, new_patterns_count, dormant_projects, ...}
  stats jsonb default '{}'::jsonb,

  triggered_at timestamptz not null default now(),
  acknowledged_at timestamptz,        -- 用户点过"知道了"
  dismissed bool default false,        -- 用户主动关闭

  unique (user_id, week_start)
);

create index if not exists idx_weekly_reviews_user_time
  on public.weekly_reviews(user_id, week_start desc);

alter table public.weekly_reviews enable row level security;

drop policy if exists weekly_reviews_all_own on public.weekly_reviews;
create policy weekly_reviews_all_own on public.weekly_reviews
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

notify pgrst, 'reload schema';
