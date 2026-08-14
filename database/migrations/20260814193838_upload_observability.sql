begin;

create or replace function public.record_import_failure(
  p_source_type text,
  p_source_label text,
  p_error_message text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_batch uuid;
  v_source_type public.source_type;
begin
  if not coalesce(private.current_user_role() in ('admin','technical_officer'), false) then
    raise exception 'forbidden';
  end if;

  if nullif(trim(p_source_label), '') is null then
    raise exception 'A source filename is required.';
  end if;

  if p_source_type not in ('master', 'portal') then
    raise exception 'Unsupported import source type.';
  end if;

  v_source_type := p_source_type::public.source_type;

  insert into public.import_batches(
    source_type,
    source_label,
    status,
    uploaded_by,
    file_count,
    error_message,
    completed_at
  )
  values (
    v_source_type,
    trim(p_source_label),
    'failed',
    auth.uid(),
    1,
    left(coalesce(nullif(trim(p_error_message), ''), 'Import failed before the data was accepted.'), 2000),
    now()
  )
  returning id into v_batch;

  perform private.write_audit(
    'IMPORT_FAILED',
    'import_batch',
    v_batch::text,
    jsonb_build_object(
      'source_type', v_source_type,
      'source_label', trim(p_source_label),
      'error', left(coalesce(nullif(trim(p_error_message), ''), 'Import failed before the data was accepted.'), 500)
    )
  );

  return v_batch;
end;
$$;

revoke all on function public.record_import_failure(text, text, text) from public, anon;
grant execute on function public.record_import_failure(text, text, text) to authenticated;

create or replace function public.get_import_history(p_limit integer default 250)
returns table (
  batch_id uuid,
  file_id uuid,
  source_type text,
  source_label text,
  original_filename text,
  batch_status text,
  file_status text,
  row_count integer,
  accepted_row_count integer,
  ignored_out_of_scope_count integer,
  duplicate_row_count integer,
  detected_start_date date,
  detected_end_date date,
  warning_count integer,
  error_message text,
  uploaded_by uuid,
  created_at timestamptz,
  completed_at timestamptz,
  data_destination text,
  original_file_retained boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    b.id,
    f.id,
    b.source_type::text,
    b.source_label,
    f.original_filename,
    b.status::text,
    f.processing_status::text,
    coalesce(f.row_count, 0),
    coalesce(f.accepted_row_count, 0),
    coalesce(f.ignored_out_of_scope_count, 0),
    coalesce(f.duplicate_row_count, 0),
    coalesce(f.detected_start_date, b.detected_start_date),
    coalesce(f.detected_end_date, b.detected_end_date),
    b.warning_count,
    b.error_message,
    b.uploaded_by,
    b.created_at,
    b.completed_at,
    case b.source_type
      when 'master' then 'Master Registry + Encrypted Credentials'
      when 'portal' then 'Portal Transaction Records'
    end,
    false
  from public.import_batches b
  left join lateral (
    select sf.*
    from public.source_files sf
    where sf.batch_id = b.id
    order by sf.created_at, sf.id
    limit 1
  ) f on true
  order by b.created_at desc
  limit greatest(1, least(coalesce(p_limit, 250), 500));
$$;

revoke all on function public.get_import_history(integer) from public, anon;
grant execute on function public.get_import_history(integer) to authenticated;

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
    select w.id, w.user_id, w.name, w.active, w.block_id, w.worker_group_id, w.latest_master_file_id
    from public.workers w
    where w.id = any(p_worker_ids) and w.deleted_at is null
    for update
  loop
    update public.workers
    set active_before_delete = v_item.active,
        active = false,
        deleted_at = v_now,
        deleted_by = auth.uid(),
        deletion_reason = nullif(trim(p_reason), ''),
        retention_until = v_now + interval '30 days'
    where id = v_item.id;

    v_count := v_count + 1;
    perform private.write_audit('MOVE_TO_TRASH', 'worker_dataset', v_item.id::text, jsonb_build_object(
      'user_id', v_item.user_id,
      'name', v_item.name,
      'deleted_at', v_now,
      'retention_until', v_now + interval '30 days',
      'reason', nullif(trim(p_reason), ''),
      'linked_records_preserved', true,
      'original_location', jsonb_build_object(
        'block_id', v_item.block_id,
        'worker_group_id', v_item.worker_group_id,
        'latest_master_file_id', v_item.latest_master_file_id,
        'active', v_item.active,
        'record_model', 'same worker_id foreign-key references'
      )
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
    select w.id, w.user_id, w.name, w.active_before_delete, w.block_id, w.worker_group_id, w.latest_master_file_id
    from public.workers w
    where w.id = any(p_worker_ids) and w.deleted_at is not null
    for update
  loop
    update public.workers
    set active = coalesce(v_item.active_before_delete, true),
        deleted_at = null,
        deleted_by = null,
        deletion_reason = null,
        active_before_delete = null,
        retention_until = null
    where id = v_item.id;

    v_count := v_count + 1;
    perform private.write_audit('RESTORE_FROM_TRASH', 'worker_dataset', v_item.id::text, jsonb_build_object(
      'user_id', v_item.user_id,
      'name', v_item.name,
      'restored_at', now(),
      'linked_records_preserved', true,
      'restored_location', jsonb_build_object(
        'block_id', v_item.block_id,
        'worker_group_id', v_item.worker_group_id,
        'latest_master_file_id', v_item.latest_master_file_id,
        'active', coalesce(v_item.active_before_delete, true),
        'record_model', 'same worker_id foreign-key references'
      )
    ));
  end loop;
  return v_count;
end;
$$;

revoke all on function public.trash_worker_datasets(uuid[], text) from public, anon;
revoke all on function public.restore_worker_datasets(uuid[]) from public, anon;
grant execute on function public.trash_worker_datasets(uuid[], text) to authenticated;
grant execute on function public.restore_worker_datasets(uuid[]) to authenticated;

commit;
