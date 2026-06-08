-- ════════════════════════════════════════════════════════════════
-- 节点规划字段：当下优先级 + 目标完成日期
-- 可重复执行；两个字段都允许为空。
-- ════════════════════════════════════════════════════════════════

alter table public.nodes
  add column if not exists current_priority text;

alter table public.nodes
  add column if not exists target_completion_date date;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'nodes_current_priority_check'
      and conrelid = 'public.nodes'::regclass
  ) then
    alter table public.nodes
      add constraint nodes_current_priority_check
      check (
        current_priority is null
        or current_priority in ('low', 'normal', 'high', 'urgent')
      );
  end if;
end $$;

create index if not exists idx_nodes_user_priority
  on public.nodes(user_id, current_priority)
  where current_priority is not null;

create index if not exists idx_nodes_user_target_completion
  on public.nodes(user_id, target_completion_date)
  where target_completion_date is not null;
