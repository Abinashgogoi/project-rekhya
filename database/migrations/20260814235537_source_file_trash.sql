begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.source_files
  add column deleted_at timestamptz,
  add column deleted_by uuid references auth.users(id),
  add column deletion_reason text,
  add column retention_until timestamptz,
  add constraint source_files_trash_dates_check check (
    (deleted_at is null and retention_until is null)
    or (deleted_at is not null and retention_until is not null and retention_until >= deleted_at)
  );

create index source_files_trash_idx on public.source_files(deleted_at desc) where deleted_at is not null;

alter table public.workers
  add column source_deleted_by_file_id uuid references public.source_files(id) on delete set null,
  add column active_before_source_delete boolean;

create index workers_source_deleted_idx on public.workers(source_deleted_by_file_id) where source_deleted_by_file_id is not null;

create table public.master_source_rows (
  id uuid primary key default gen_random_uuid(),
  source_file_id uuid not null references public.source_files(id) on delete cascade,
  worker_id uuid references public.workers(id) on delete set null,
  source_row_number integer not null check (source_row_number > 0),
  user_id text not null,
  name text not null,
  password_ciphertext text not null,
  block_name text,
  group_name text,
  extra_fields jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(source_file_id, user_id)
);

create index master_source_rows_user_idx on public.master_source_rows(user_id, created_at desc);
create index master_source_rows_worker_idx on public.master_source_rows(worker_id);

alter table public.master_source_rows enable row level security;
grant select, insert, update, delete on public.master_source_rows to authenticated;
revoke all on public.master_source_rows from anon;

create policy master_source_rows_operational_read on public.master_source_rows
for select to authenticated
using (private.current_user_role() in ('admin','technical_officer','field_officer','auditor'));

create policy master_source_rows_technical_insert on public.master_source_rows
for insert to authenticated
with check (private.current_user_role() in ('admin','technical_officer'));

create policy master_source_rows_technical_update on public.master_source_rows
for update to authenticated
using (private.current_user_role() in ('admin','technical_officer'))
with check (private.current_user_role() in ('admin','technical_officer'));

create policy master_source_rows_technical_delete on public.master_source_rows
for delete to authenticated
using (private.current_user_role() in ('admin','technical_officer'));

create or replace function private.apply_latest_master_snapshot(p_user_id text, p_deleted_source_file uuid default null)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_snapshot record;
  v_worker uuid;
  v_block uuid;
  v_group uuid;
begin
  select msr.*
  into v_snapshot
  from public.master_source_rows msr
  join public.source_files sf on sf.id = msr.source_file_id and sf.deleted_at is null
  join public.import_batches ib on ib.id = sf.batch_id and ib.status in ('processed','processed_with_warnings')
  where msr.user_id = p_user_id
  order by sf.created_at desc, msr.created_at desc, msr.id desc
  limit 1;

  select w.id into v_worker from public.workers w where w.user_id = p_user_id for update;

  if v_snapshot.id is null then
    if v_worker is not null then
      update public.workers
      set active_before_source_delete = active,
          active = false,
          source_deleted_by_file_id = p_deleted_source_file
      where id = v_worker and deleted_at is null;
    end if;
    return;
  end if;

  v_block := null;
  v_group := null;
  if nullif(trim(v_snapshot.block_name), '') is not null then
    insert into public.blocks(name) values (trim(v_snapshot.block_name))
    on conflict(name) do update set active = true
    returning id into v_block;
  end if;
  if nullif(trim(v_snapshot.group_name), '') is not null then
    select id into v_group from public.worker_groups where name = v_snapshot.group_name;
  end if;

  if v_worker is null then
    insert into public.workers(user_id, name, block_id, worker_group_id, active, latest_master_file_id, master_row_number, extra_fields)
    values (v_snapshot.user_id, v_snapshot.name, v_block, v_group, true, v_snapshot.source_file_id, v_snapshot.source_row_number, v_snapshot.extra_fields)
    returning id into v_worker;
  else
    update public.workers
    set name = v_snapshot.name,
        block_id = v_block,
        worker_group_id = v_group,
        active = case when deleted_at is null then true else false end,
        latest_master_file_id = v_snapshot.source_file_id,
        master_row_number = v_snapshot.source_row_number,
        extra_fields = v_snapshot.extra_fields,
        source_deleted_by_file_id = null,
        active_before_source_delete = null
    where id = v_worker;
  end if;

  update public.master_source_rows set worker_id = v_worker where id = v_snapshot.id;
  insert into public.worker_credentials(worker_id, password_ciphertext, source_file_id, source_row_number, updated_by)
  values (v_worker, v_snapshot.password_ciphertext, v_snapshot.source_file_id, v_snapshot.source_row_number, auth.uid())
  on conflict(worker_id) do update
  set password_ciphertext = excluded.password_ciphertext,
      source_file_id = excluded.source_file_id,
      source_row_number = excluded.source_row_number,
      updated_by = auth.uid();
end;
$$;

revoke all on function private.apply_latest_master_snapshot(text, uuid) from public, anon;
grant execute on function private.apply_latest_master_snapshot(text, uuid) to authenticated;

create or replace function private.recalculate_portal_fingerprints(p_file_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  with affected as (
    select distinct pr.row_fingerprint
    from public.portal_records pr
    where pr.source_file_id = any(p_file_ids)
  )
  update public.portal_records pr
  set included_in_totals = false,
      overlap_status = 'potential_duplicate'
  where pr.row_fingerprint in (select row_fingerprint from affected);

  with affected as (
    select distinct pr.row_fingerprint
    from public.portal_records pr
    where pr.source_file_id = any(p_file_ids)
  ), ranked as (
    select pr.id,
      row_number() over (
        partition by pr.row_fingerprint
        order by sf.created_at, pr.imported_at, pr.source_row_number, pr.id
      ) as position
    from public.portal_records pr
    join public.source_files sf on sf.id = pr.source_file_id and sf.deleted_at is null
    where pr.row_fingerprint in (select row_fingerprint from affected)
  )
  update public.portal_records pr
  set included_in_totals = (ranked.position = 1),
      overlap_status = case when ranked.position = 1 then 'none' else 'potential_duplicate' end
  from ranked
  where pr.id = ranked.id;
end;
$$;

revoke all on function private.recalculate_portal_fingerprints(uuid[]) from public, anon;
grant execute on function private.recalculate_portal_fingerprints(uuid[]) to authenticated;

create or replace function public.ingest_master_payload(p_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_batch uuid; v_file uuid; v_record jsonb; v_block uuid; v_group uuid; v_worker uuid; v_count integer := 0;
begin
  if private.current_user_role() not in ('admin','technical_officer') then raise exception 'forbidden'; end if;
  if coalesce(jsonb_array_length(p_payload->'records'),0)=0 then raise exception 'master file has no valid rows'; end if;
  insert into public.import_batches(source_type, source_label, status, uploaded_by, file_count)
  values ('master', p_payload->>'source_label', 'processing', auth.uid(), 1) returning id into v_batch;
  insert into public.source_files(batch_id, original_filename, sha256, mime_type, row_count, accepted_row_count, header_map, processing_status)
  values (v_batch, p_payload->>'original_filename', p_payload->>'sha256', p_payload->>'mime_type', (p_payload->>'row_count')::integer, jsonb_array_length(p_payload->'records'), coalesce(p_payload->'header_map','{}'::jsonb), 'processing')
  returning id into v_file;
  for v_record in select value from jsonb_array_elements(p_payload->'records') loop
    v_block := null; v_group := null;
    if nullif(trim(v_record->>'block'),'') is not null then
      insert into public.blocks(name) values (trim(v_record->>'block')) on conflict(name) do update set active=true returning id into v_block;
    end if;
    if nullif(trim(v_record->>'group'),'') is not null then select id into v_group from public.worker_groups where name=v_record->>'group'; end if;
    insert into public.workers(user_id,name,block_id,worker_group_id,active,latest_master_file_id,master_row_number,extra_fields,source_deleted_by_file_id,active_before_source_delete)
    values (v_record->>'user_id',v_record->>'name',v_block,v_group,true,v_file,(v_record->>'source_row_number')::integer,coalesce(v_record->'extra_fields','{}'::jsonb),null,null)
    on conflict(user_id) do update set name=excluded.name,block_id=excluded.block_id,worker_group_id=excluded.worker_group_id,active=true,latest_master_file_id=excluded.latest_master_file_id,master_row_number=excluded.master_row_number,extra_fields=excluded.extra_fields,source_deleted_by_file_id=null,active_before_source_delete=null
    returning id into v_worker;
    insert into public.worker_credentials(worker_id,password_ciphertext,source_file_id,source_row_number,updated_by)
    values(v_worker,v_record->>'password_ciphertext',v_file,(v_record->>'source_row_number')::integer,auth.uid())
    on conflict(worker_id) do update set password_ciphertext=excluded.password_ciphertext,source_file_id=excluded.source_file_id,source_row_number=excluded.source_row_number,updated_by=auth.uid();
    insert into public.master_source_rows(source_file_id,worker_id,source_row_number,user_id,name,password_ciphertext,block_name,group_name,extra_fields)
    values(v_file,v_worker,(v_record->>'source_row_number')::integer,v_record->>'user_id',v_record->>'name',v_record->>'password_ciphertext',nullif(trim(v_record->>'block'),''),nullif(trim(v_record->>'group'),''),coalesce(v_record->'extra_fields','{}'::jsonb));
    v_count := v_count + 1;
  end loop;
  update public.source_files set processing_status='processed' where id=v_file;
  update public.import_batches set status='processed',completed_at=now() where id=v_batch;
  perform private.write_audit('IMPORT_MASTER','import_batch',v_batch::text,jsonb_build_object('source_file_id',v_file,'accepted_rows',v_count));
  return jsonb_build_object('batch_id',v_batch,'source_file_id',v_file,'accepted_rows',v_count);
end;
$$;

revoke all on function public.ingest_master_payload(jsonb) from public, anon;
grant execute on function public.ingest_master_payload(jsonb) to authenticated;

create or replace function public.trash_source_files(p_file_ids uuid[], p_reason text default null)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_file record;
  v_user_id text;
  v_count integer := 0;
begin
  if not coalesce(private.current_user_role() in ('admin','technical_officer'), false) then raise exception 'forbidden'; end if;
  if coalesce(cardinality(p_file_ids), 0) = 0 then raise exception 'Select at least one uploaded source file.'; end if;

  for v_file in
    update public.source_files sf
    set deleted_at = v_now,
        deleted_by = auth.uid(),
        deletion_reason = nullif(trim(p_reason), ''),
        retention_until = v_now + interval '30 days'
    from public.import_batches ib
    where sf.id = any(p_file_ids) and sf.deleted_at is null and ib.id = sf.batch_id
    returning sf.id, sf.batch_id, sf.original_filename, ib.source_type
  loop
    v_count := v_count + 1;
    if v_file.source_type = 'master' then
      for v_user_id in select msr.user_id from public.master_source_rows msr where msr.source_file_id = v_file.id loop
        perform private.apply_latest_master_snapshot(v_user_id, v_file.id);
      end loop;
    else
      perform private.recalculate_portal_fingerprints(array[v_file.id]);
    end if;
    perform private.write_audit('MOVE_SOURCE_TO_TRASH','source_file',v_file.id::text,jsonb_build_object(
      'batch_id',v_file.batch_id,
      'filename',v_file.original_filename,
      'source_type',v_file.source_type,
      'deleted_at',v_now,
      'retention_until',v_now + interval '30 days',
      'reason',nullif(trim(p_reason),'')
    ));
  end loop;
  return v_count;
end;
$$;

create or replace function public.restore_source_files(p_file_ids uuid[])
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_file record;
  v_user_id text;
  v_count integer := 0;
begin
  if not coalesce(private.current_user_role() in ('admin','technical_officer'), false) then raise exception 'forbidden'; end if;
  if coalesce(cardinality(p_file_ids), 0) = 0 then raise exception 'Select at least one uploaded source file from Trash.'; end if;

  for v_file in
    update public.source_files sf
    set deleted_at = null, deleted_by = null, deletion_reason = null, retention_until = null
    from public.import_batches ib
    where sf.id = any(p_file_ids) and sf.deleted_at is not null and ib.id = sf.batch_id
    returning sf.id, sf.batch_id, sf.original_filename, ib.source_type
  loop
    v_count := v_count + 1;
    if v_file.source_type = 'master' then
      for v_user_id in select msr.user_id from public.master_source_rows msr where msr.source_file_id = v_file.id loop
        perform private.apply_latest_master_snapshot(v_user_id, null);
      end loop;
    else
      perform private.recalculate_portal_fingerprints(array[v_file.id]);
    end if;
    perform private.write_audit('RESTORE_SOURCE_FROM_TRASH','source_file',v_file.id::text,jsonb_build_object(
      'batch_id',v_file.batch_id,
      'filename',v_file.original_filename,
      'source_type',v_file.source_type,
      'restored_at',now(),
      'restored_destination',case when v_file.source_type='master' then 'Master Registry + Encrypted Credentials' else 'Portal Transaction Records' end
    ));
  end loop;
  return v_count;
end;
$$;

create or replace function public.get_source_file_trash()
returns table (
  file_id uuid,
  batch_id uuid,
  source_type text,
  filename text,
  deleted_at timestamptz,
  retention_until timestamptz,
  deletion_reason text,
  deleted_by_name text,
  row_count integer,
  accepted_row_count integer,
  affected_record_count bigint,
  detected_start_date date,
  detected_end_date date,
  data_destination text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select sf.id, sf.batch_id, ib.source_type::text, sf.original_filename,
    sf.deleted_at, sf.retention_until, sf.deletion_reason, p.display_name,
    sf.row_count, sf.accepted_row_count,
    case ib.source_type
      when 'master' then (select count(*) from public.master_source_rows msr where msr.source_file_id=sf.id)
      else (select count(*) from public.portal_records pr where pr.source_file_id=sf.id)
    end,
    sf.detected_start_date, sf.detected_end_date,
    case ib.source_type when 'master' then 'Master Registry + Encrypted Credentials' else 'Portal Transaction Records' end
  from public.source_files sf
  join public.import_batches ib on ib.id=sf.batch_id
  left join public.profiles p on p.id=sf.deleted_by
  where sf.deleted_at is not null
  order by sf.deleted_at desc, sf.id;
$$;

create or replace function public.purge_source_files(p_file_ids uuid[])
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_targets uuid[];
  v_batches uuid[];
  v_orphan_workers uuid[];
  v_file record;
  v_count integer := 0;
begin
  if private.current_user_role() is distinct from 'admin'::public.officer_role then raise exception 'Only an administrator can permanently delete uploaded source files.'; end if;
  select coalesce(array_agg(sf.id), '{}'::uuid[]), coalesce(array_agg(distinct sf.batch_id), '{}'::uuid[])
  into v_targets, v_batches
  from public.source_files sf where sf.id=any(p_file_ids) and sf.deleted_at is not null;
  if cardinality(v_targets)=0 then raise exception 'No selected uploaded source file is currently in Trash.'; end if;

  for v_file in
    select sf.id, sf.batch_id, sf.original_filename, ib.source_type
    from public.source_files sf join public.import_batches ib on ib.id=sf.batch_id
    where sf.id=any(v_targets)
  loop
    perform private.write_audit('PERMANENT_DELETE_SOURCE','source_file',v_file.id::text,jsonb_build_object(
      'batch_id',v_file.batch_id,'filename',v_file.original_filename,'source_type',v_file.source_type,'purged_at',now()
    ));
  end loop;

  select coalesce(array_agg(w.id), '{}'::uuid[])
  into v_orphan_workers
  from public.workers w
  where w.source_deleted_by_file_id=any(v_targets)
    and not exists (
      select 1 from public.master_source_rows msr
      join public.source_files sf on sf.id=msr.source_file_id and sf.deleted_at is null
      where msr.user_id=w.user_id and not (sf.id=any(v_targets))
    );

  if cardinality(v_orphan_workers)>0 then
    delete from public.notifications where worker_id=any(v_orphan_workers);
    delete from public.reconciliation_rows where worker_id=any(v_orphan_workers);
    delete from public.payment_records where worker_id=any(v_orphan_workers);
    delete from public.evidence_files where worker_id=any(v_orphan_workers);
    delete from public.app_summaries where worker_id=any(v_orphan_workers);
    delete from public.app_records where worker_id=any(v_orphan_workers);
    delete from public.verification_jobs where worker_id=any(v_orphan_workers);
    delete from public.portal_records where worker_id=any(v_orphan_workers);
    delete from public.worker_credentials where worker_id=any(v_orphan_workers);
    delete from public.workers where id=any(v_orphan_workers);
  end if;

  delete from public.portal_records where source_file_id=any(v_targets);
  delete from public.master_source_rows where source_file_id=any(v_targets);
  delete from public.source_files where id=any(v_targets) and deleted_at is not null;
  get diagnostics v_count = row_count;
  delete from public.import_batches ib where ib.id=any(v_batches) and not exists(select 1 from public.source_files sf where sf.batch_id=ib.id);

  return jsonb_build_object('purged_count',v_count,'audit_history_preserved',true);
end;
$$;

revoke all on function public.trash_source_files(uuid[], text) from public, anon;
revoke all on function public.restore_source_files(uuid[]) from public, anon;
revoke all on function public.get_source_file_trash() from public, anon;
revoke all on function public.purge_source_files(uuid[]) from public, anon;
grant execute on function public.trash_source_files(uuid[], text) to authenticated;
grant execute on function public.restore_source_files(uuid[]) to authenticated;
grant execute on function public.get_source_file_trash() to authenticated;
grant execute on function public.purge_source_files(uuid[]) to authenticated;

drop function if exists public.get_import_history(integer);
create function public.get_import_history(p_limit integer default 250)
returns table (
  batch_id uuid, file_id uuid, source_type text, source_label text, original_filename text,
  batch_status text, file_status text, row_count integer, accepted_row_count integer,
  ignored_out_of_scope_count integer, duplicate_row_count integer,
  detected_start_date date, detected_end_date date, warning_count integer, error_message text,
  uploaded_by uuid, created_at timestamptz, completed_at timestamptz,
  data_destination text, original_file_retained boolean,
  file_deleted_at timestamptz, file_retention_until timestamptz, is_trashed boolean
)
language sql stable security invoker set search_path='' as $$
  select b.id,f.id,b.source_type::text,b.source_label,f.original_filename,b.status::text,f.processing_status::text,
    coalesce(f.row_count,0),coalesce(f.accepted_row_count,0),coalesce(f.ignored_out_of_scope_count,0),coalesce(f.duplicate_row_count,0),
    coalesce(f.detected_start_date,b.detected_start_date),coalesce(f.detected_end_date,b.detected_end_date),b.warning_count,b.error_message,
    b.uploaded_by,b.created_at,b.completed_at,
    case b.source_type when 'master' then 'Master Registry + Encrypted Credentials' else 'Portal Transaction Records' end,
    false,f.deleted_at,f.retention_until,(f.deleted_at is not null)
  from public.import_batches b
  left join lateral(select sf.* from public.source_files sf where sf.batch_id=b.id order by sf.created_at,sf.id limit 1) f on true
  order by b.created_at desc
  limit greatest(1,least(coalesce(p_limit,250),500));
$$;
revoke all on function public.get_import_history(integer) from public, anon;
grant execute on function public.get_import_history(integer) to authenticated;

create or replace function public.get_reconciliation_report(p_start date, p_end date, p_block text default null, p_group text default null, p_search text default null)
returns table (
  worker_id uuid, serial_no bigint, name text, user_id text, block text, group_name text,
  portal_entry bigint, normal_total bigint, high_entry bigint, app_entry bigint,
  dashboard_unpaid integer, unpaid_list_count integer, pre_cutoff_count bigint, verification_status text,
  krishi_sakhi_received numeric, krishi_sakhi_pending numeric, vendor_received numeric, vendor_pending numeric,
  evidence_count bigint
)
language sql stable security invoker set search_path='' as $$
  with eligible as (
    select w.id,w.name,w.user_id,b.name as block,g.name as group_name
    from public.workers w
    left join public.blocks b on b.id=w.block_id
    left join public.worker_groups g on g.id=w.worker_group_id
    where w.active and w.deleted_at is null and w.source_deleted_by_file_id is null
      and (p_block is null or b.name=p_block)
      and (p_group is null or g.name=p_group)
      and (p_search is null or w.user_id ilike '%'||p_search||'%' or w.name ilike '%'||p_search||'%')
  ), latest_job as (
    select distinct on(j.worker_id) j.worker_id,j.dashboard_unpaid,j.unpaid_list_count,j.status::text as verification_status
    from public.verification_jobs j join public.verification_runs r on r.id=j.run_id
    where r.start_date=p_start and r.end_date=p_end
    order by j.worker_id,coalesce(j.completed_at,j.started_at) desc nulls last
  )
  select e.id,row_number() over(order by e.block nulls last,e.name,e.user_id),e.name,e.user_id,e.block,e.group_name,
    (select count(*) from public.portal_records pr join public.source_files sf on sf.id=pr.source_file_id and sf.deleted_at is null where pr.worker_id=e.id and pr.included_in_totals and pr.transaction_date between p_start and p_end),
    (select count(*) from public.app_records ar where ar.worker_id=e.id and ar.application_date between p_start and p_end and ar.amount=100),
    (select count(*) from public.app_records ar where ar.worker_id=e.id and ar.application_date between p_start and p_end and ar.amount>100),
    (select count(*) from public.app_records ar where ar.worker_id=e.id and ar.application_date between p_start and p_end and ar.amount>=100),
    lj.dashboard_unpaid,lj.unpaid_list_count,
    (select count(*) from public.app_records ar where ar.worker_id=e.id and ar.application_date<p_start),
    lj.verification_status,ks.amount_received,ks.pending_amount,v.amount_received,v.pending_amount,
    (select count(*) from public.evidence_files ef where ef.worker_id=e.id)
  from eligible e
  left join latest_job lj on lj.worker_id=e.id
  left join public.payment_records ks on ks.worker_id=e.id and ks.group_type='krishi_sakhi'
  left join public.payment_records v on v.worker_id=e.id and v.group_type='vendor'
  order by e.block nulls last,e.name,e.user_id;
$$;

create or replace function public.queue_verification_run(p_start date,p_end date)
returns uuid language plpgsql security invoker set search_path='' as $$
declare v_run uuid; v_count integer;
begin
  if private.current_user_role() not in ('admin','technical_officer') then raise exception 'forbidden'; end if;
  if p_start is null or p_end is null or p_start>p_end then raise exception 'invalid inclusive date range'; end if;
  insert into public.verification_runs(start_date,end_date,status,started_by) values(p_start,p_end,'queued',auth.uid()) returning id into v_run;
  insert into public.verification_jobs(run_id,worker_id,queue_position,expected_user_id)
  select v_run,w.id,row_number() over(order by b.name nulls last,w.name,w.user_id),w.user_id
  from public.workers w left join public.blocks b on b.id=w.block_id
  where w.active and w.deleted_at is null and w.source_deleted_by_file_id is null;
  get diagnostics v_count=row_count;
  insert into public.agent_commands(command,run_id,requested_by) values('start',v_run,auth.uid());
  update public.agent_status set total_ids=v_count,completed_ids=0,running_ids=0,password_pending=0,network_pending=0,current_user_id=null,current_stage='Queued for start' where singleton;
  perform private.write_audit('QUEUE_VERIFICATION','verification_run',v_run::text,jsonb_build_object('start_date',p_start,'end_date',p_end,'total_ids',v_count));
  return v_run;
end;
$$;

revoke all on function public.queue_verification_run(date,date) from public,anon;
grant execute on function public.queue_verification_run(date,date) to authenticated;

do $$
begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='source_files') then
    alter publication supabase_realtime add table public.source_files;
  end if;
end
$$;

commit;
