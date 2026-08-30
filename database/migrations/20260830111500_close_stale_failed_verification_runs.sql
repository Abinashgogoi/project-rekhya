-- Close historical queued test runs whose start command already failed.
-- Preserve history; do not delete runs/jobs.

with stale_runs as (
  select vr.id
  from public.verification_runs vr
  where vr.status='queued'
    and vr.created_at < now() - interval '24 hours'
    and not exists (
      select 1 from public.agent_commands ac
      where ac.run_id=vr.id and ac.status in ('queued','accepted')
    )
    and exists (
      select 1 from public.agent_commands ac
      where ac.run_id=vr.id and ac.command='start' and ac.status='failed'
    )
)
update public.verification_jobs vj
set status='stopped',
    current_stage='Closed stale historical test run',
    error_message=coalesce(vj.error_message,'Historical queued job closed after failed start command'),
    completed_at=coalesce(vj.completed_at,now())
where vj.run_id in (select id from stale_runs)
  and vj.status='queued';

with stale_runs as (
  select vr.id
  from public.verification_runs vr
  where vr.status='queued'
    and vr.created_at < now() - interval '24 hours'
    and not exists (
      select 1 from public.agent_commands ac
      where ac.run_id=vr.id and ac.status in ('queued','accepted')
    )
    and exists (
      select 1 from public.agent_commands ac
      where ac.run_id=vr.id and ac.command='start' and ac.status='failed'
    )
)
update public.verification_runs vr
set status='stopped', completed_at=coalesce(vr.completed_at,now())
where vr.id in (select id from stale_runs);

create or replace function public.queue_verification_run(p_start date, p_end date)
returns uuid
language plpgsql
set search_path to ''
as $function$
declare v_run uuid; v_count integer;
begin
  if private.current_user_role() not in ('admin','technical_officer') then
    raise exception 'forbidden';
  end if;
  if p_start is null or p_end is null or p_start>p_end then
    raise exception 'invalid inclusive date range';
  end if;

  if exists (
    select 1
    from public.verification_runs vr
    where vr.status in ('queued','running','paused')
      and (
        exists(
          select 1 from public.agent_commands ac
          where ac.run_id=vr.id and ac.status in ('queued','accepted')
        )
        or exists(
          select 1 from public.verification_jobs vj
          where vj.run_id=vr.id and vj.status in ('running','paused')
        )
        or (vr.status='queued' and vr.created_at >= now()-interval '30 minutes')
      )
  ) then
    raise exception 'A verification run is already queued, running, or paused. Resume/finish it before starting another full run.';
  end if;

  insert into public.verification_runs(start_date,end_date,status,started_by)
  values(p_start,p_end,'queued',auth.uid())
  returning id into v_run;

  insert into public.verification_jobs(run_id,worker_id,queue_position,expected_user_id)
  select v_run,w.id,row_number() over(order by b.name nulls last,w.name,w.user_id),w.user_id
  from public.workers w
  left join public.blocks b on b.id=w.block_id
  where w.active and w.deleted_at is null and w.source_deleted_by_file_id is null;

  get diagnostics v_count=row_count;

  if v_count=0 then
    delete from public.verification_runs where id=v_run;
    raise exception 'No active in-scope User IDs found';
  end if;

  insert into public.agent_commands(command,run_id,requested_by)
  values('start',v_run,auth.uid());

  update public.agent_status
  set total_ids=v_count,completed_ids=0,running_ids=0,password_pending=0,
      network_pending=0,current_user_id=null,current_stage='Queued for start'
  where singleton;

  perform private.write_audit(
    'QUEUE_VERIFICATION','verification_run',v_run::text,
    jsonb_build_object('start_date',p_start,'end_date',p_end,'total_ids',v_count)
  );

  return v_run;
end;
$function$;