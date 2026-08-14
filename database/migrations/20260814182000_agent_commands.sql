begin;

create table public.agent_commands (
  id uuid primary key default gen_random_uuid(),
  command text not null check (command in ('start','pause','resume','retry_pending','stop_safely')),
  run_id uuid references public.verification_runs(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued','accepted','completed','failed')),
  requested_by uuid not null references auth.users(id),
  requested_at timestamptz not null default now(),
  accepted_at timestamptz,
  completed_at timestamptz,
  error_message text
);
create index agent_commands_queue_idx on public.agent_commands(status,requested_at);
create index agent_commands_run_idx on public.agent_commands(run_id);
create index agent_commands_requested_by_idx on public.agent_commands(requested_by);
alter table public.agent_commands enable row level security;
grant select,insert,update on public.agent_commands to authenticated;
revoke all on public.agent_commands from anon;
create policy agent_commands_read on public.agent_commands for select to authenticated using (private.current_user_role() in ('admin','technical_officer','field_officer','auditor'));
create policy agent_commands_insert on public.agent_commands for insert to authenticated with check (private.current_user_role() in ('admin','technical_officer') and requested_by=(select auth.uid()));
create policy agent_commands_update on public.agent_commands for update to authenticated using (private.current_user_role() in ('admin','technical_officer')) with check (private.current_user_role() in ('admin','technical_officer'));

create or replace function public.queue_verification_run(p_start date,p_end date)
returns uuid language plpgsql security invoker set search_path='' as $$
declare v_run uuid; v_count integer;
begin
  if private.current_user_role() not in ('admin','technical_officer') then raise exception 'forbidden'; end if;
  if p_start is null or p_end is null or p_start>p_end then raise exception 'invalid inclusive date range'; end if;
  insert into public.verification_runs(start_date,end_date,status,started_by) values(p_start,p_end,'queued',auth.uid()) returning id into v_run;
  insert into public.verification_jobs(run_id,worker_id,queue_position,expected_user_id)
  select v_run,w.id,row_number() over(order by b.name nulls last,w.name,w.user_id),w.user_id from public.workers w left join public.blocks b on b.id=w.block_id where w.active;
  get diagnostics v_count=row_count;
  insert into public.agent_commands(command,run_id,requested_by) values('start',v_run,auth.uid());
  update public.agent_status set total_ids=v_count,completed_ids=0,running_ids=0,password_pending=0,network_pending=0,current_user_id=null,current_stage='Queued for start' where singleton;
  perform private.write_audit('QUEUE_VERIFICATION','verification_run',v_run::text,jsonb_build_object('start_date',p_start,'end_date',p_end,'total_ids',v_count));
  return v_run;
end;
$$;
revoke all on function public.queue_verification_run(date,date) from public,anon;
grant execute on function public.queue_verification_run(date,date) to authenticated;

create or replace function public.enqueue_agent_command(p_command text,p_run_id uuid default null)
returns uuid language plpgsql security invoker set search_path='' as $$
declare v_id uuid;
begin
  if private.current_user_role() not in ('admin','technical_officer') then raise exception 'forbidden'; end if;
  if p_command not in ('pause','resume','retry_pending','stop_safely') then raise exception 'invalid command'; end if;
  insert into public.agent_commands(command,run_id,requested_by) values(p_command,p_run_id,auth.uid()) returning id into v_id;
  perform private.write_audit('AGENT_COMMAND','agent_command',v_id::text,jsonb_build_object('command',p_command,'run_id',p_run_id));
  return v_id;
end;
$$;
revoke all on function public.enqueue_agent_command(text,uuid) from public,anon;
grant execute on function public.enqueue_agent_command(text,uuid) to authenticated;

alter publication supabase_realtime add table public.agent_commands;

commit;
