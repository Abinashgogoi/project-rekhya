begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.source_files
  add column import_sequence bigint generated always as identity;

create unique index source_files_import_sequence_idx
  on public.source_files(import_sequence);

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

commit;
