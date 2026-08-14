alter table public.worker_credentials
  add column if not exists password_missing boolean not null default false;

alter table public.master_source_rows
  add column if not exists password_missing boolean not null default false;

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
  order by sf.import_sequence desc, msr.source_row_number desc, msr.id desc
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
  insert into public.worker_credentials(worker_id, password_ciphertext, password_missing, source_file_id, source_row_number, updated_by)
  values (v_worker, v_snapshot.password_ciphertext, v_snapshot.password_missing, v_snapshot.source_file_id, v_snapshot.source_row_number, auth.uid())
  on conflict(worker_id) do update
  set password_ciphertext = excluded.password_ciphertext,
      password_missing = excluded.password_missing,
      source_file_id = excluded.source_file_id,
      source_row_number = excluded.source_row_number,
      updated_by = auth.uid();
end;
$$;

revoke all on function private.apply_latest_master_snapshot(text, uuid) from public, anon;
grant execute on function private.apply_latest_master_snapshot(text, uuid) to authenticated;

create or replace function public.ingest_master_payload(p_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_batch uuid; v_file uuid; v_record jsonb; v_block uuid; v_group uuid; v_worker uuid; v_count integer := 0;
  v_password_missing boolean;
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
    v_password_missing := coalesce((v_record->>'password_missing')::boolean, false);
    if nullif(trim(v_record->>'block'),'') is not null then
      insert into public.blocks(name) values (trim(v_record->>'block')) on conflict(name) do update set active=true returning id into v_block;
    end if;
    if nullif(trim(v_record->>'group'),'') is not null then select id into v_group from public.worker_groups where name=v_record->>'group'; end if;
    insert into public.workers(user_id,name,block_id,worker_group_id,active,latest_master_file_id,master_row_number,extra_fields,source_deleted_by_file_id,active_before_source_delete)
    values (v_record->>'user_id',v_record->>'name',v_block,v_group,true,v_file,(v_record->>'source_row_number')::integer,coalesce(v_record->'extra_fields','{}'::jsonb),null,null)
    on conflict(user_id) do update set name=excluded.name,block_id=excluded.block_id,worker_group_id=excluded.worker_group_id,active=true,latest_master_file_id=excluded.latest_master_file_id,master_row_number=excluded.master_row_number,extra_fields=excluded.extra_fields,source_deleted_by_file_id=null,active_before_source_delete=null
    returning id into v_worker;
    insert into public.worker_credentials(worker_id,password_ciphertext,password_missing,source_file_id,source_row_number,updated_by)
    values(v_worker,v_record->>'password_ciphertext',v_password_missing,v_file,(v_record->>'source_row_number')::integer,auth.uid())
    on conflict(worker_id) do update set password_ciphertext=excluded.password_ciphertext,password_missing=excluded.password_missing,source_file_id=excluded.source_file_id,source_row_number=excluded.source_row_number,updated_by=auth.uid();
    insert into public.master_source_rows(source_file_id,worker_id,source_row_number,user_id,name,password_ciphertext,password_missing,block_name,group_name,extra_fields)
    values(v_file,v_worker,(v_record->>'source_row_number')::integer,v_record->>'user_id',v_record->>'name',v_record->>'password_ciphertext',v_password_missing,nullif(trim(v_record->>'block'),''),nullif(trim(v_record->>'group'),''),coalesce(v_record->'extra_fields','{}'::jsonb));
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
