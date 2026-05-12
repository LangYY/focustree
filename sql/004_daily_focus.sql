-- ════════════════════════════════════════════════════════════════
-- Phase 5.2 · 每日聚焦表（Today 视图）
-- 每个用户每天一行（unique user_id+date），tasks 是 AI 生成的 3 件事
-- ════════════════════════════════════════════════════════════════

create table if not exists public.daily_focus (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  tasks jsonb not null default '[]'::jsonb,
  -- tasks 单条结构：
  -- {
  --   node_id: uuid?,       -- 关联到 nodes 的 id；null 表示 AI 提议但尚未加入树
  --   name: text,
  --   energy_tier: '早上' | '下午' | '晚上' | '任意',
  --   why: text,            -- AI 给的一句话理由
  --   done: bool            -- 用户是否完成
  -- }
  generated_at timestamptz not null default now(),
  unique (user_id, date)
);

create index if not exists idx_daily_focus_user_date
  on public.daily_focus(user_id, date desc);

alter table public.daily_focus enable row level security;

drop policy if exists daily_focus_all_own on public.daily_focus;
create policy daily_focus_all_own on public.daily_focus
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

notify pgrst, 'reload schema';
