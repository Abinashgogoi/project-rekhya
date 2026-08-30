begin;

alter table public.agent_commands drop constraint if exists agent_commands_command_check;
alter table public.agent_commands add constraint agent_commands_command_check
  check (command in ('prepare','start','pause','resume','retry_pending','stop_safely'));

create or replace function public.enqueue_prepare_agent()
returns uuid language plpgsql security definer set search_path='public','private' as $$
declare v_id uuid;
begin
  if private.current_user_role() not in ('admin'::officer_role,'technical_officer'::officer_role) then
    raise exception 'Technical access required';
  end if;
  delete from public.agent_commands where command='prepare' and status='queued' and requested_by=auth.uid();
  insert into public.agent_commands(command,run_id,requested_by) values('prepare',null,auth.uid()) returning id into v_id;
  perform private.write_audit('AGENT_PREPARE','agent_command',v_id::text,jsonb_build_object('command','prepare'));
  return v_id;
end;
$$;
revoke all on function public.enqueue_prepare_agent() from public,anon;
grant execute on function public.enqueue_prepare_agent() to authenticated;

commit;
