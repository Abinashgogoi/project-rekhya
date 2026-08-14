begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.workers
  add column deleted_at timestamptz,
  add column deleted_by uuid references auth.users(id),
  add column deletion_reason text,
  add column active_before_delete boolean,
  add column retention_until timestamptz,
  add constraint workers_trash_dates_check check (
    (deleted_at is null and retention_until is null)
    or (deleted_at is not null and retention_until is not null and retention_until >= deleted_at)
  );

create index workers_trash_idx on public.workers(deleted_at desc) where deleted_at is not null;

create or replace function private.prevent_implicit_trash_restore()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.deleted_at is not null and new.deleted_at is not null and new.active then
    raise exception 'User ID % is in Trash. Restore it from Project Rekhya before importing or activating it.', old.user_id;
  end if;
  return new;
end;
$$;
revoke all on function private.prevent_implicit_trash_restore() from public, anon;

create trigger prevent_implicit_trash_restore
before update on public.workers
for each row execute function private.prevent_implicit_trash_restore();

create or replace function public.trash_worker_datasets(p_worker_ids uuid[], p_reason text default null)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_item record;
  v_count integer := 0;
begin
  if not coalesce(private.current_user_role() in ('admin','technical_officer'), false) then
    raise exception 'forbidden';
  end if;
  if coalesce(cardinality(p_worker_ids), 0) = 0 then
    raise exception 'Select at least one User ID.';
  end if;

  for v_item in
    update public.workers
    set active_before_delete = active,
        active = false,
        deleted_at = v_now,
        deleted_by = auth.uid(),
        deletion_reason = nullif(trim(p_reason), ''),
        retention_until = v_now + interval '30 days'
    where id = any(p_worker_ids) and deleted_at is null
    returning id, user_id, name
  loop
    v_count := v_count + 1;
    perform private.write_audit(
      'MOVE_TO_TRASH', 'worker_dataset', v_item.id::text,
      jsonb_build_object(
        'user_id', v_item.user_id,
        'name', v_item.name,
        'deleted_at', v_now,
        'retention_until', v_now + interval '30 days',
        'reason', nullif(trim(p_reason), '')
      )
    );
  end loop;

  return v_count;
end;
$$;
revoke all on function public.trash_worker_datasets(uuid[], text) from public, anon;
grant execute on function public.trash_worker_datasets(uuid[], text) to authenticated;

create or replace function public.restore_worker_datasets(p_worker_ids uuid[])
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_item record;
  v_count integer := 0;
begin
  if not coalesce(private.current_user_role() in ('admin','technical_officer'), false) then
    raise exception 'forbidden';
  end if;
  if coalesce(cardinality(p_worker_ids), 0) = 0 then
    raise exception 'Select at least one Trash item.';
  end if;

  for v_item in
    update public.workers
    set active = coalesce(active_before_delete, true),
        deleted_at = null,
        deleted_by = null,
        deletion_reason = null,
        active_before_delete = null,
        retention_until = null
    where id = any(p_worker_ids) and deleted_at is not null
    returning id, user_id, name
  loop
    v_count := v_count + 1;
    perform private.write_audit(
      'RESTORE_FROM_TRASH', 'worker_dataset', v_item.id::text,
      jsonb_build_object('user_id', v_item.user_id, 'name', v_item.name, 'restored_at', now())
    );
  end loop;

  return v_count;
end;
$$;
revoke all on function public.restore_worker_datasets(uuid[]) from public, anon;
grant execute on function public.restore_worker_datasets(uuid[]) to authenticated;

create or replace function public.get_worker_trash()
returns table (
  worker_id uuid,
  name text,
  user_id text,
  block text,
  group_name text,
  deleted_at timestamptz,
  retention_until timestamptz,
  deletion_reason text,
  deleted_by_name text,
  portal_count bigint,
  app_count bigint,
  evidence_count bigint,
  payment_count bigint,
  verification_count bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if not coalesce(private.current_user_role() in ('admin','technical_officer'), false) then
    raise exception 'forbidden';
  end if;

  return query
  select
    w.id,
    w.name,
    w.user_id,
    b.name,
    g.name,
    w.deleted_at,
    w.retention_until,
    w.deletion_reason,
    coalesce(p.display_name, w.deleted_by::text),
    (select count(*) from public.portal_records pr where pr.worker_id = w.id),
    (select count(*) from public.app_records ar where ar.worker_id = w.id),
    (select count(*) from public.evidence_files ef where ef.worker_id = w.id),
    (select count(*) from public.payment_records pay where pay.worker_id = w.id),
    (select count(*) from public.verification_jobs vj where vj.worker_id = w.id)
  from public.workers w
  left join public.blocks b on b.id = w.block_id
  left join public.worker_groups g on g.id = w.worker_group_id
  left join public.profiles p on p.id = w.deleted_by
  where w.deleted_at is not null
  order by w.deleted_at desc, w.name, w.user_id;
end;
$$;
revoke all on function public.get_worker_trash() from public, anon;
grant execute on function public.get_worker_trash() to authenticated;

create or replace function public.purge_worker_datasets(p_worker_ids uuid[])
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_targets uuid[];
  v_storage jsonb;
  v_count integer := 0;
  v_item record;
begin
  if private.current_user_role() is distinct from 'admin'::public.officer_role then
    raise exception 'Only an administrator can permanently delete Trash items.';
  end if;
  if coalesce(cardinality(p_worker_ids), 0) = 0 then
    raise exception 'Select at least one Trash item.';
  end if;

  select coalesce(array_agg(w.id), '{}'::uuid[])
  into v_targets
  from public.workers w
  where w.id = any(p_worker_ids) and w.deleted_at is not null;

  if cardinality(v_targets) = 0 then
    raise exception 'No selected User ID is currently in Trash.';
  end if;

  select coalesce(
    jsonb_agg(jsonb_build_object('bucket', ef.storage_bucket, 'path', ef.storage_path)),
    '[]'::jsonb
  )
  into v_storage
  from public.evidence_files ef
  where ef.worker_id = any(v_targets);

  for v_item in
    select w.id, w.user_id, w.name, w.deleted_at
    from public.workers w
    where w.id = any(v_targets)
  loop
    perform private.write_audit(
      'PERMANENT_DELETE', 'worker_dataset', v_item.id::text,
      jsonb_build_object(
        'user_id', v_item.user_id,
        'name', v_item.name,
        'trashed_at', v_item.deleted_at,
        'purged_at', now()
      )
    );
  end loop;

  delete from public.notifications where worker_id = any(v_targets);
  delete from public.reconciliation_rows where worker_id = any(v_targets);
  delete from public.payment_records where worker_id = any(v_targets);
  delete from public.evidence_files where worker_id = any(v_targets);
  delete from public.app_summaries where worker_id = any(v_targets);
  delete from public.app_records where worker_id = any(v_targets);
  delete from public.verification_jobs where worker_id = any(v_targets);
  delete from public.portal_records where worker_id = any(v_targets);
  delete from public.worker_credentials where worker_id = any(v_targets);
  delete from public.workers where id = any(v_targets) and deleted_at is not null;
  get diagnostics v_count = row_count;

  return jsonb_build_object(
    'purged_count', v_count,
    'storage_objects', v_storage,
    'audit_history_preserved', true
  );
end;
$$;
revoke all on function public.purge_worker_datasets(uuid[]) from public, anon;
grant execute on function public.purge_worker_datasets(uuid[]) to authenticated;

drop policy if exists workers_operational_read on public.workers;
create policy workers_operational_read on public.workers
for select to authenticated
using (
  private.current_user_role() in ('admin','technical_officer')
  or (
    private.current_user_role() in ('field_officer','auditor')
    and deleted_at is null
  )
);

create or replace function public.get_reconciliation_report(p_start date, p_end date, p_block text default null, p_group text default null, p_search text default null)
returns table (
  worker_id uuid, serial_no bigint, name text, user_id text, block text, group_name text,
  portal_entry bigint, normal_total bigint, high_entry bigint, app_entry bigint,
  dashboard_unpaid integer, unpaid_list_count integer, pre_cutoff_count bigint, verification_status text,
  krishi_sakhi_received numeric, krishi_sakhi_pending numeric, vendor_received numeric, vendor_pending numeric,
  evidence_count bigint
)
language sql stable security invoker set search_path = '' as $$
  with eligible as (
    select w.id, w.name, w.user_id, b.name as block, g.name as group_name
    from public.workers w
    left join public.blocks b on b.id = w.block_id
    left join public.worker_groups g on g.id = w.worker_group_id
    where w.active and w.deleted_at is null
      and (p_block is null or b.name = p_block)
      and (p_group is null or g.name = p_group)
      and (p_search is null or w.user_id ilike '%' || p_search || '%' or w.name ilike '%' || p_search || '%')
  ), latest_job as (
    select distinct on (j.worker_id) j.worker_id, j.dashboard_unpaid, j.unpaid_list_count, j.status::text as verification_status
    from public.verification_jobs j
    join public.verification_runs r on r.id = j.run_id
    where r.start_date = p_start and r.end_date = p_end
    order by j.worker_id, coalesce(j.completed_at, j.started_at) desc nulls last
  )
  select e.id, row_number() over (order by e.block nulls last, e.name, e.user_id), e.name, e.user_id, e.block, e.group_name,
    (select count(*) from public.portal_records pr where pr.worker_id=e.id and pr.included_in_totals and pr.transaction_date between p_start and p_end),
    (select count(*) from public.app_records ar where ar.worker_id=e.id and ar.application_date between p_start and p_end and ar.amount = 100),
    (select count(*) from public.app_records ar where ar.worker_id=e.id and ar.application_date between p_start and p_end and ar.amount > 100),
    (select count(*) from public.app_records ar where ar.worker_id=e.id and ar.application_date between p_start and p_end and ar.amount >= 100),
    lj.dashboard_unpaid, lj.unpaid_list_count,
    (select count(*) from public.app_records ar where ar.worker_id=e.id and ar.application_date < p_start),
    lj.verification_status,
    ks.amount_received, ks.pending_amount, v.amount_received, v.pending_amount,
    (select count(*) from public.evidence_files ef where ef.worker_id=e.id)
  from eligible e
  left join latest_job lj on lj.worker_id=e.id
  left join public.payment_records ks on ks.worker_id=e.id and ks.group_type='krishi_sakhi'
  left join public.payment_records v on v.worker_id=e.id and v.group_type='vendor'
  order by e.block nulls last, e.name, e.user_id;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'workers'
  ) then
    alter publication supabase_realtime add table public.workers;
  end if;
end
$$;

commit;
