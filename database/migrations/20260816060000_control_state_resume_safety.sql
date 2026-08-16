begin;

create or replace function public.latest_resumable_verification_run()
returns uuid
language sql
stable
set search_path=''
as $$
  select vr.id
  from public.verification_runs vr
  where vr.status in ('queued','running','paused')
    and exists (
      select 1
      from public.verification_jobs vj
      where vj.run_id=vr.id
        and vj.status in ('queued','running','paused','pending')
    )
  order by coalesce(vr.started_at,vr.created_at) desc
  limit 1
$$;

create or replace function public.enqueue_resume_latest()
returns uuid
language plpgsql
security definer
set search_path=public,private
as $$
declare
  v_run uuid;
  v_command uuid;
begin
  if private.current_user_role() not in ('admin'::officer_role,'technical_officer'::officer_role) then
    raise exception 'Technical access required';
  end if;

  v_run := public.latest_resumable_verification_run();
  if v_run is null then
    raise exception 'No resumable verification run exists';
  end if;

  insert into public.agent_commands(command,run_id,requested_by)
  values('resume',v_run,auth.uid())
  returning id into v_command;

  return v_command;
end;
$$;

grant execute on function public.enqueue_resume_latest() to authenticated;

commit;
