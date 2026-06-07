-- ════════════════════════════════════════════════════════════════
-- Phase 0 · 核心表：项目树与对话存档
-- 必须先于 001-005 执行。
-- ════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ── 1. 项目树节点 ───────────────────────────────────────────────
create table if not exists public.nodes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  parent_id uuid references public.nodes(id) on delete cascade,

  name text not null check (char_length(btrim(name)) > 0),
  type text not null check (type in ('project', 'category', 'task')),
  status text not null default 'active' check (status in ('active', 'done', 'dormant', 'dropped')),

  color text,
  weight real not null default 1.0 check (weight >= 0 and weight <= 2),
  position bigint not null default ((extract(epoch from now()) * 1000)::bigint),
  expanded boolean not null default true,

  last_active_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (parent_id is null or parent_id <> id)
);

create index if not exists idx_nodes_user_parent_position
  on public.nodes(user_id, parent_id, position);

create index if not exists idx_nodes_user_status
  on public.nodes(user_id, status);

create index if not exists idx_nodes_user_completed
  on public.nodes(user_id, completed_at desc)
  where completed_at is not null;

create index if not exists idx_nodes_user_last_active
  on public.nodes(user_id, last_active_at desc);

create or replace function public.touch_nodes()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_touch_nodes on public.nodes;
create trigger trg_touch_nodes
  before update on public.nodes
  for each row execute function public.touch_nodes();

create or replace function public.validate_node_parent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  parent_user uuid;
  creates_cycle boolean;
begin
  if new.parent_id is null then
    return new;
  end if;

  if new.parent_id = new.id then
    raise exception 'node cannot be its own parent';
  end if;

  select user_id into parent_user
  from public.nodes
  where id = new.parent_id;

  if parent_user is null then
    raise exception 'parent node does not exist';
  end if;

  if parent_user <> new.user_id then
    raise exception 'parent node belongs to another user';
  end if;

  with recursive ancestors(id, parent_id) as (
    select id, parent_id
    from public.nodes
    where id = new.parent_id
    union all
    select n.id, n.parent_id
    from public.nodes n
    join ancestors a on n.id = a.parent_id
  )
  select exists(select 1 from ancestors where id = new.id)
    into creates_cycle;

  if creates_cycle then
    raise exception 'node parent would create a cycle';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_node_parent on public.nodes;
create trigger trg_validate_node_parent
  before insert or update of parent_id, user_id on public.nodes
  for each row execute function public.validate_node_parent();

-- ── 2. 对话原始存档 ─────────────────────────────────────────────
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists idx_conversations_user_time
  on public.conversations(user_id, created_at desc);

-- ── 3. RLS ─────────────────────────────────────────────────────
alter table public.nodes enable row level security;
alter table public.conversations enable row level security;

drop policy if exists "nodes_all_own" on public.nodes;
create policy "nodes_all_own" on public.nodes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "conversations_all_own" on public.conversations;
create policy "conversations_all_own" on public.conversations
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

notify pgrst, 'reload schema';
