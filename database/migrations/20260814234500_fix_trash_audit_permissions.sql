begin;

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
  if not coalesce(private.current_user_role() in ('admin','technical_officer'), false) then raise exception 'forbidden'; end if;
  if coalesce(cardinality(p_worker_ids), 0) = 0 then raise exception 'Select at least one User ID.'; end if;

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
    perform private.write_audit('MOVE_TO_TRASH', 'worker_dataset', v_item.id::text, jsonb_build_object(
      'user_id', v_item.user_id, 'name', v_item.name, 'deleted_at', v_now,
      'retention_until', v_now + interval '30 days', 'reason', nullif(trim(p_reason), '')
    ));
  end loop;
  return v_count;
end;
$$;

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
  if not coalesce(private.current_user_role() in ('admin','technical_officer'), false) then raise exception 'forbidden'; end if;
  if coalesce(cardinality(p_worker_ids), 0) = 0 then raise exception 'Select at least one Trash item.'; end if;

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
    perform private.write_audit('RESTORE_FROM_TRASH', 'worker_dataset', v_item.id::text, jsonb_build_object(
      'user_id', v_item.user_id, 'name', v_item.name, 'restored_at', now()
    ));
  end loop;
  return v_count;
end;
$$;

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
  if private.current_user_role() is distinct from 'admin'::public.officer_role then raise exception 'Only an administrator can permanently delete Trash items.'; end if;
  if coalesce(cardinality(p_worker_ids), 0) = 0 then raise exception 'Select at least one Trash item.'; end if;

  select coalesce(array_agg(w.id), '{}'::uuid[]) into v_targets
  from public.workers w where w.id = any(p_worker_ids) and w.deleted_at is not null;
  if cardinality(v_targets) = 0 then raise exception 'No selected User ID is currently in Trash.'; end if;

  select coalesce(jsonb_agg(jsonb_build_object('bucket', ef.storage_bucket, 'path', ef.storage_path)), '[]'::jsonb)
  into v_storage from public.evidence_files ef where ef.worker_id = any(v_targets);

  for v_item in select w.id, w.user_id, w.name, w.deleted_at from public.workers w where w.id = any(v_targets)
  loop
    perform private.write_audit('PERMANENT_DELETE', 'worker_dataset', v_item.id::text, jsonb_build_object(
      'user_id', v_item.user_id, 'name', v_item.name, 'trashed_at', v_item.deleted_at, 'purged_at', now()
    ));
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

  return jsonb_build_object('purged_count', v_count, 'storage_objects', v_storage, 'audit_history_preserved', true);
end;
$$;

revoke all on function public.trash_worker_datasets(uuid[], text) from public, anon;
revoke all on function public.restore_worker_datasets(uuid[]) from public, anon;
revoke all on function public.purge_worker_datasets(uuid[]) from public, anon;
grant execute on function public.trash_worker_datasets(uuid[], text) to authenticated;
grant execute on function public.restore_worker_datasets(uuid[]) to authenticated;
grant execute on function public.purge_worker_datasets(uuid[]) to authenticated;

commit;
