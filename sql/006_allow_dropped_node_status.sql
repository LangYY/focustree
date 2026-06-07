-- Allow nodes to be marked as dropped: kept in the tree, but excluded from active planning.

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select conname
    from pg_constraint
    where conrelid = 'public.nodes'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%status%'
      and pg_get_constraintdef(oid) like '%active%'
      and pg_get_constraintdef(oid) like '%done%'
      and pg_get_constraintdef(oid) like '%dormant%'
  loop
    execute format('alter table public.nodes drop constraint %I', constraint_name);
  end loop;
end $$;

alter table public.nodes
  add constraint nodes_status_check
  check (status in ('active', 'done', 'dormant', 'dropped'));
