begin;

create or replace function private.write_audit(p_action text, p_entity_type text, p_entity_id text, p_after jsonb default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or private.current_user_role() is null then raise exception 'unauthorized'; end if;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, after_data)
  values (auth.uid(), p_action, p_entity_type, p_entity_id, p_after);
end;
$$;
revoke all on function private.write_audit(text,text,text,jsonb) from public, anon;
grant execute on function private.write_audit(text,text,text,jsonb) to authenticated;

create or replace function public.record_credential_access(p_worker_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if private.current_user_role() not in ('admin','technical_officer','field_officer') then raise exception 'forbidden'; end if;
  perform private.write_audit('VIEW', 'worker_credential', p_worker_id::text, null);
end;
$$;
revoke all on function public.record_credential_access(uuid) from public, anon;
grant execute on function public.record_credential_access(uuid) to authenticated;

create or replace function public.ingest_master_payload(p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
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
    insert into public.workers(user_id,name,block_id,worker_group_id,active,latest_master_file_id,master_row_number,extra_fields)
    values (v_record->>'user_id',v_record->>'name',v_block,v_group,true,v_file,(v_record->>'source_row_number')::integer,coalesce(v_record->'extra_fields','{}'::jsonb))
    on conflict(user_id) do update set name=excluded.name,block_id=excluded.block_id,worker_group_id=excluded.worker_group_id,active=true,latest_master_file_id=excluded.latest_master_file_id,master_row_number=excluded.master_row_number,extra_fields=excluded.extra_fields
    returning id into v_worker;
    insert into public.worker_credentials(worker_id,password_ciphertext,source_file_id,source_row_number,updated_by)
    values(v_worker,v_record->>'password_ciphertext',v_file,(v_record->>'source_row_number')::integer,auth.uid())
    on conflict(worker_id) do update set password_ciphertext=excluded.password_ciphertext,source_file_id=excluded.source_file_id,source_row_number=excluded.source_row_number,updated_by=auth.uid();
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

create or replace function public.ingest_portal_payload(p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_batch uuid; v_file uuid; v_record jsonb; v_worker uuid; v_fingerprint text; v_cross_overlap boolean; v_within_duplicate boolean;
  v_count integer := 0; v_ignored integer := coalesce((p_payload->>'ignored_out_of_scope')::integer,0); v_overlap integer := 0; v_start date; v_end date;
begin
  if private.current_user_role() not in ('admin','technical_officer') then raise exception 'forbidden'; end if;
  if coalesce(jsonb_array_length(p_payload->'records'),0)=0 then raise exception 'portal file has no valid in-scope rows'; end if;
  insert into public.import_batches(source_type,source_label,status,uploaded_by,file_count)
  values('portal',p_payload->>'source_label','processing',auth.uid(),1) returning id into v_batch;
  insert into public.source_files(batch_id,original_filename,sha256,mime_type,row_count,accepted_row_count,ignored_out_of_scope_count,header_map,processing_status)
  values(v_batch,p_payload->>'original_filename',p_payload->>'sha256',p_payload->>'mime_type',(p_payload->>'row_count')::integer,jsonb_array_length(p_payload->'records'),v_ignored,coalesce(p_payload->'header_map','{}'::jsonb),'processing')
  returning id into v_file;
  for v_record in select value from jsonb_array_elements(p_payload->'records') loop
    select id into v_worker from public.workers where user_id=v_record->>'user_id' and active;
    if v_worker is null then v_ignored:=v_ignored+1; continue; end if;
    v_fingerprint := encode(extensions.digest(v_record->>'fingerprint_source','sha256'),'hex');
    select exists(select 1 from public.portal_records pr where pr.row_fingerprint=v_fingerprint and pr.source_file_id<>v_file and pr.included_in_totals) into v_cross_overlap;
    v_within_duplicate := coalesce((v_record->>'possible_duplicate_within_file')::boolean,false);
    insert into public.portal_records(worker_id,source_file_id,source_row_number,row_fingerprint,transaction_date,amount,policy_id,applicant_name,status,raw_fields,included_in_totals,overlap_status)
    values(v_worker,v_file,(v_record->>'source_row_number')::integer,v_fingerprint,(v_record->>'transaction_date')::date,nullif(v_record->>'amount','')::numeric,nullif(v_record->>'policy_id',''),nullif(v_record->>'applicant_name',''),nullif(v_record->>'status',''),coalesce(v_record->'raw_fields','{}'::jsonb),not v_cross_overlap,case when v_cross_overlap or v_within_duplicate then 'potential_duplicate' else 'none' end);
    if v_cross_overlap or v_within_duplicate then
      insert into public.import_conflicts(source_file_id,conflicting_file_id,conflict_type,row_fingerprint,detail)
      values(v_file,(select pr.source_file_id from public.portal_records pr where pr.row_fingerprint=v_fingerprint and pr.source_file_id<>v_file order by pr.imported_at limit 1),case when v_cross_overlap then 'cross_file_overlap' else 'duplicate_within_file' end,v_fingerprint,jsonb_build_object('source_row_number',v_record->>'source_row_number','included_in_totals',not v_cross_overlap));
      v_overlap:=v_overlap+1;
    end if;
    v_count:=v_count+1;
  end loop;
  select min(transaction_date),max(transaction_date) into v_start,v_end from public.portal_records where source_file_id=v_file;
  update public.source_files set processing_status=case when v_overlap>0 then 'processed_with_warnings'::public.import_status else 'processed'::public.import_status end,accepted_row_count=v_count,ignored_out_of_scope_count=v_ignored,duplicate_row_count=v_overlap,detected_start_date=v_start,detected_end_date=v_end where id=v_file;
  update public.import_batches set status=case when v_overlap>0 then 'processed_with_warnings'::public.import_status else 'processed'::public.import_status end,detected_start_date=v_start,detected_end_date=v_end,warning_count=v_overlap,completed_at=now() where id=v_batch;
  perform private.write_audit('IMPORT_PORTAL','import_batch',v_batch::text,jsonb_build_object('source_file_id',v_file,'accepted_rows',v_count,'ignored_out_of_scope',v_ignored,'overlap_warnings',v_overlap));
  return jsonb_build_object('batch_id',v_batch,'source_file_id',v_file,'accepted_rows',v_count,'ignored_out_of_scope',v_ignored,'overlap_warnings',v_overlap,'detected_start_date',v_start,'detected_end_date',v_end);
end;
$$;
revoke all on function public.ingest_portal_payload(jsonb) from public, anon;
grant execute on function public.ingest_portal_payload(jsonb) to authenticated;

commit;
