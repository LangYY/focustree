-- ════════════════════════════════════════════════════════════════
-- 第二阶段：节点策略标签 + 推荐决策档案
-- ════════════════════════════════════════════════════════════════

-- ── 1. 节点策略标签 ──────────────────────────────────────────────
-- 每个 node 的策略向量。一对一关系，主键即 node_id。
create table if not exists public.node_annotations (
  node_id uuid primary key references public.nodes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,

  -- ROI 类型分布，例如 {"现金": 0.8, "经验": 0.1, "资产": 0.1}
  roi_type jsonb default '{}'::jsonb,

  -- 立即 / 短期 / 中期 / 长期
  time_horizon text check (time_horizon in ('立即', '短期', '中期', '长期')),

  -- 高专注 / 中等 / 机械
  energy_cost text check (energy_cost in ('高专注', '中等', '机械')),

  -- 可操作性 0-1
  feasibility real check (feasibility >= 0 and feasibility <= 1),

  -- 确定性 / 投机性
  risk text check (risk in ('确定性', '投机性')),

  -- 现金流 / 资产积累 / 信号建立 / 维持性 / 探索
  strategic_tag text,

  -- AI 给这个节点写的备注（解释为什么这样标）
  ai_notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_node_annotations_user on public.node_annotations(user_id);

create or replace function public.touch_node_annotations()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists trg_touch_node_annotations on public.node_annotations;
create trigger trg_touch_node_annotations
  before update on public.node_annotations
  for each row execute function public.touch_node_annotations();

-- ── 2. 推荐决策档案 ──────────────────────────────────────────────
-- 每一次 AI 推荐的完整推理链
create table if not exists public.recommendation_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  -- 用户提的问题
  message text not null,

  -- 当时的目标快照
  goal_snapshot jsonb,

  -- AI 的推理链：{ user_goal, traps_avoided[], leverage_insight, ... }
  thinking jsonb,

  -- AI 的最终回复
  reply text,

  -- 候选 / 推荐
  primary_node_id uuid,
  alternative_node_ids uuid[],

  -- 反馈（用户接受 / 拒绝 / 修改），1 周后回填 outcome
  feedback text check (feedback in ('accepted', 'rejected', 'modified', null)),
  outcome  text check (outcome  in ('completed', 'dropped', null)),
  outcome_at timestamptz,

  created_at timestamptz not null default now()
);

create index if not exists idx_recommendation_log_user_time
  on public.recommendation_log(user_id, created_at desc);

-- ── 3. RLS ───────────────────────────────────────────────────────

alter table public.node_annotations    enable row level security;
alter table public.recommendation_log  enable row level security;

drop policy if exists "node_annotations_all_own" on public.node_annotations;
create policy "node_annotations_all_own" on public.node_annotations
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "recommendation_log_all_own" on public.recommendation_log;
create policy "recommendation_log_all_own" on public.recommendation_log
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
