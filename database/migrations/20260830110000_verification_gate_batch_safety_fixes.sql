-- Verification gate safety fixes. Applied to production Supabase on 2026-08-30.
-- This file keeps repository migration history aligned with the live database.

create or replace function public.get_reconciliation_report(p_start date, p_end date, p_block text default null::text, p_group text default null::text, p_search text default null::text)
returns table(worker_id uuid, serial_no bigint, name text, user_id text, block text, group_name text, portal_entry bigint, normal_total bigint, high_entry bigint, app_entry bigint, dashboard_unpaid integer, unpaid_list_count integer, pre_cutoff_count bigint, verification_status text, issue_type text, krishi_sakhi_received numeric, krishi_sakhi_pending numeric, vendor_received numeric, vendor_pending numeric, sesta_received numeric, sesta_pending numeric, evidence_count bigint)
language sql stable set search_path to ''
as $function$
  with eligible as (
    select w.id,w.name,w.user_id,b.name as block,g.name as group_name
    from public.workers w
    left join public.blocks b on b.id=w.block_id
    left join public.worker_groups g on g.id=w.worker_group_id
    where w.active and w.deleted_at is null and w.source_deleted_by_file_id is null
      and (p_block is null or b.name=p_block)
      and (p_group is null or g.name=p_group)
      and (p_search is null or w.user_id ilike '%'||p_search||'%' or w.name ilike '%'||p_search||'%')
  ), latest_summary as (
    select distinct on (s.worker_id)
      s.worker_id,s.run_id,s.normal_total,s.high_total,s.dashboard_unpaid,s.unpaid_list_count,s.pre_cutoff_count,
      s.status::text as summary_status,s.issue_type::text as summary_issue_type,s.created_at
    from public.app_summaries s
    join public.verification_runs r on r.id=s.run_id
    where r.start_date=p_start and r.end_date=p_end
    order by s.worker_id,s.created_at desc
  ), latest_job as (
    select distinct on(j.worker_id)
      j.worker_id,j.status::text as job_status,j.issue_type::text as issue_type,
      coalesce(j.completed_at,j.started_at) as event_at
    from public.verification_jobs j
    join public.verification_runs r on r.id=j.run_id
    where r.start_date=p_start and r.end_date=p_end
    order by j.worker_id,coalesce(j.completed_at,j.started_at) desc nulls last
  ), app_values as (
    select e.id as worker_id,
      coalesce(ls.normal_total,0)::bigint as normal_total,
      coalesce(ls.high_total,0)::bigint as high_total,
      (coalesce(ls.normal_total,0)+coalesce(ls.high_total,0))::bigint as app_entry,
      ls.dashboard_unpaid,ls.unpaid_list_count,
      coalesce(ls.pre_cutoff_count,0)::bigint as pre_cutoff_count,
      case when ls.dashboard_unpaid is not null and ls.unpaid_list_count is not null and ls.dashboard_unpaid <> ls.unpaid_list_count
           then 'count_mismatch' else coalesce(ls.summary_status,lj.job_status) end as verification_status,
      case when ls.dashboard_unpaid is not null and ls.unpaid_list_count is not null and ls.dashboard_unpaid <> ls.unpaid_list_count
           then 'count_mismatch' else coalesce(ls.summary_issue_type,lj.issue_type) end as issue_type
    from eligible e
    left join latest_summary ls on ls.worker_id=e.id
    left join latest_job lj on lj.worker_id=e.id
  )
  select e.id,row_number() over(order by e.block nulls last,e.name,e.user_id),e.name,e.user_id,e.block,e.group_name,
    (select count(*) from public.portal_records pr join public.source_files sf on sf.id=pr.source_file_id and sf.deleted_at is null where pr.worker_id=e.id and pr.included_in_totals and pr.transaction_date between p_start and p_end),
    av.normal_total,av.high_total,av.app_entry,
    av.dashboard_unpaid,av.unpaid_list_count,av.pre_cutoff_count,av.verification_status,av.issue_type,
    ks.amount_received,ks.pending_amount,v.amount_received,v.pending_amount,s.amount_received,s.pending_amount,
    (select count(*) from public.evidence_files ef where ef.worker_id=e.id)
  from eligible e
  left join app_values av on av.worker_id=e.id
  left join public.payment_records ks on ks.worker_id=e.id and ks.group_type::text='krishi_sakhi'
  left join public.payment_records v on v.worker_id=e.id and v.group_type::text='vendor'
  left join public.payment_records s on s.worker_id=e.id and s.group_type::text='sesta'
  order by e.block nulls last,e.name,e.user_id;
$function$;

create or replace function public.queue_verification_run(p_start date, p_end date)
returns uuid language plpgsql set search_path to ''
as $function$
declare v_run uuid; v_count integer;
begin
  if private.current_user_role() not in ('admin','technical_officer') then raise exception 'forbidden'; end if;
  if p_start is null or p_end is null or p_start>p_end then raise exception 'invalid inclusive date range'; end if;
  if exists(select 1 from public.verification_runs vr where vr.status in ('queued','running','paused'))
     or exists(select 1 from public.agent_commands ac where ac.command in ('start','resume') and ac.status in ('queued','accepted'))
  then raise exception 'A verification run is already queued, running, or paused. Resume/finish it before starting another full run.'; end if;

  insert into public.verification_runs(start_date,end_date,status,started_by)
  values(p_start,p_end,'queued',auth.uid()) returning id into v_run;

  insert into public.verification_jobs(run_id,worker_id,queue_position,expected_user_id)
  select v_run,w.id,row_number() over(order by b.name nulls last,w.name,w.user_id),w.user_id
  from public.workers w left join public.blocks b on b.id=w.block_id
  where w.active and w.deleted_at is null and w.source_deleted_by_file_id is null;
  get diagnostics v_count=row_count;

  if v_count=0 then delete from public.verification_runs where id=v_run; raise exception 'No active in-scope User IDs found'; end if;
  insert into public.agent_commands(command,run_id,requested_by) values('start',v_run,auth.uid());
  update public.agent_status set total_ids=v_count,completed_ids=0,running_ids=0,password_pending=0,network_pending=0,current_user_id=null,current_stage='Queued for start' where singleton;
  perform private.write_audit('QUEUE_VERIFICATION','verification_run',v_run::text,jsonb_build_object('start_date',p_start,'end_date',p_end,'total_ids',v_count));
  return v_run;
end;
$function$;

create or replace function public.enqueue_retry_pending_latest()
returns uuid language plpgsql set search_path to ''
as $function$
declare v_id uuid; v_run uuid;
begin
  if private.current_user_role() not in ('admin','technical_officer') then raise exception 'forbidden'; end if;
  select vr.id into v_run from public.verification_runs vr
  where exists(select 1 from public.verification_jobs vj where vj.run_id=vr.id and vj.status='pending' and not vj.final_retry_attempted)
  order by coalesce(vr.started_at,vr.created_at) desc limit 1;
  if v_run is null then raise exception 'no pending verification jobs remain eligible for the one final retry'; end if;
  insert into public.agent_commands(command,run_id,requested_by) values('retry_pending',v_run,auth.uid()) returning id into v_id;
  perform private.write_audit('AGENT_COMMAND','agent_command',v_id::text,jsonb_build_object('command','retry_pending','run_id',v_run,'final_retry',true));
  return v_id;
end;
$function$;

create or replace function public.enqueue_prepare_agent()
returns uuid language plpgsql security definer set search_path to 'public','private'
as $function$
declare v_id uuid;
begin
  if private.current_user_role() not in ('admin'::officer_role,'technical_officer'::officer_role) then raise exception 'Technical access required'; end if;
  update public.agent_commands set status='failed',completed_at=now(),error_message='Superseded stale Prepare Android command'
  where command='prepare' and status='accepted' and accepted_at < now()-interval '90 seconds';
  delete from public.agent_commands where command='prepare' and status='queued' and requested_by=auth.uid();
  insert into public.agent_commands(command,run_id,requested_by) values('prepare',null,auth.uid()) returning id into v_id;
  perform private.write_audit('AGENT_PREPARE','agent_command',v_id::text,jsonb_build_object('command','prepare'));
  return v_id;
end;
$function$;
