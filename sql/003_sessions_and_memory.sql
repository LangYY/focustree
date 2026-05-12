-- ════════════════════════════════════════════════════════════════
-- 第三阶段：会话分组 + 摘要 + 学习模式
-- ════════════════════════════════════════════════════════════════

-- ── 1. conversations 增加 session_id ─────────────────────────────
alter table public.conversations
  add column if not exists session_id uuid;

create index if not exists idx_conversations_user_session
  on public.conversations(user_id, session_id);

create index if not exists idx_conversations_user_created
  on public.conversations(user_id, created_at desc);

-- ── 2. 回填历史 conversations：按 30 分钟 gap 切分 session ────────
-- 思路：使用窗口函数计算与上一条消息的时间间隔，gap > 30min 则开新 session
do $$
declare
  rec record;
  prev_user uuid := null;
  prev_ts timestamptz := null;
  curr_session uuid := null;
begin
  -- 只处理 session_id 还是 null 的行
  for rec in
    select id, user_id, created_at
    from public.conversations
    where session_id is null
    order by user_id, created_at
  loop
    if rec.user_id is distinct from prev_user
       or prev_ts is null
       or rec.created_at - prev_ts > interval '30 minutes' then
      curr_session := gen_random_uuid();
    end if;

    update public.conversations
       set session_id = curr_session
     where id = rec.id;

    prev_user := rec.user_id;
    prev_ts   := rec.created_at;
  end loop;
end $$;

-- ── 3. session_summaries 表 ──────────────────────────────────────
create table if not exists public.session_summaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null unique,

  summary text not null,
  key_decisions jsonb default '[]'::jsonb,
  topics jsonb default '[]'::jsonb,

  message_count int default 0,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_session_summaries_user_time
  on public.session_summaries(user_id, ended_at desc);

-- ── 4. RLS ───────────────────────────────────────────────────────
alter table public.session_summaries enable row level security;

drop policy if exists "session_summaries_all_own" on public.session_summaries;
create policy "session_summaries_all_own" on public.session_summaries
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── 5. user_profile.learned_patterns 已经存在（jsonb default '[]'）
-- 每条结构：{ observation, confidence, topic, created_at, source_session }
-- 不需要 schema 变更，agent 直接 push 进去

-- 强制 schema reload
notify pgrst, 'reload schema';
