-- Start Full Run semantics:
--   * never resumes an old run
--   * preserves old history
--   * supersedes unfinished old runs/jobs/commands
--   * creates exactly one fresh run from the first active User ID
-- Resume latest remains the only continuation control.

create or replace function public.restart_verification_from_beginning(
  p_start date,
  p_end date
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_run uuid;
  v_count integer;
begin
  if private.current_user_role() not in ('admin','technical_officer') then
    raise exception 'forbidden';
  end if;

  if p_start is null or p_end is null or p_start > p_end then
    raise exception 'invalid inclusive date range';
  end if;

  -- Serialize fresh-start requests. A double click cannot create two batches.
  perform pg_advisory_xact_lock(hashtext('project-rekhya:fresh-full-run'));

  -- Preserve history but close unfinished commands from older runs.
  update public.agent_commands ac
  set status = 'failed',
      completed_at = coalesce(ac.completed_at, now()),
      error_message = coalesce(
        ac.error_message,
        'Superseded by Start Full Run fresh-start request'
      )
  where ac.status in ('queued','accepted')
    and ac.run_id in (
      select vr.id
      from public.verification_runs vr
      where vr.status in ('queued','running','paused')
    );

  -- Any unfinished account from the superseded run is stopped, not deleted.
  update public.verification_jobs vj
  set status = 'stopped',
      completed_at = coalesce(vj.completed_at, now()),
      current_stage = 'Superseded by fresh full run',
      error_message = coalesce(
        vj.error_message,
        'Previous run superseded by Start Full Run'
      )
  where vj.status in ('queued','running','paused','pending')
    and vj.run_id in (
      select vr.id
      from public.verification_runs vr
      where vr.status in ('queued','running','paused')
    );

  update public.verification_runs vr
  set status = 'stopped',
      completed_at = coalesce(vr.completed_at, now())
  where vr.status in ('queued','running','paused');

  insert into public.verification_runs(
    start_date,
    end_date,
    status,
    started_by
  )
  values (
    p_start,
    p_end,
    'queued',
    auth.uid()
  )
  returning id into v_run;

  insert into public.verification_jobs(
    run_id,
    worker_id,
    queue_position,
    expected_user_id
  )
  select
    v_run,
    w.id,
    row_number() over (
      order by b.name nulls last, w.name, w.user_id
    ),
    w.user_id
  from public.workers w
  left join public.blocks b on b.id = w.block_id
  where w.active
    and w.deleted_at is null
    and w.source_deleted_by_file_id is null;

  get diagnostics v_count = row_count;

  if v_count = 0 then
    delete from public.verification_runs where id = v_run;
    raise exception 'No active in-scope User IDs found';
  end if;

  insert into public.agent_commands(
    command,
    run_id,
    requested_by
  )
  values (
    'start',
    v_run,
    auth.uid()
  );

  update public.agent_status
  set total_ids = v_count,
      completed_ids = 0,
      running_ids = 0,
      password_pending = 0,
      network_pending = 0,
      current_user_id = null,
      current_stage = 'Fresh full run queued from first User ID'
  where singleton;

  perform private.write_audit(
    'RESTART_VERIFICATION_FROM_BEGINNING',
    'verification_run',
    v_run::text,
    jsonb_build_object(
      'start_date', p_start,
      'end_date', p_end,
      'total_ids', v_count,
      'semantics', 'fresh_start_supersedes_unfinished_runs'
    )
  );

  return v_run;
end;
$function$;

revoke all on function public.restart_verification_from_beginning(date,date)
from public, anon;

grant execute on function public.restart_verification_from_beginning(date,date)
to authenticated;