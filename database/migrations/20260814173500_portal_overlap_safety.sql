begin;

alter table public.source_files add constraint source_files_sha256_unique unique (sha256);
alter table public.portal_records drop constraint portal_records_source_file_id_row_fingerprint_key;
alter table public.portal_records add column included_in_totals boolean not null default true;
alter table public.portal_records add column overlap_status text not null default 'none' check (overlap_status in ('none','potential_duplicate','confirmed_unique','excluded_duplicate'));
create index portal_records_fingerprint_idx on public.portal_records(row_fingerprint);

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
    where w.active
      and (p_block is null or b.name = p_block)
      and (p_group is null or g.name = p_group)
      and (p_search is null or w.user_id ilike '%' || p_search || '%' or w.name ilike '%' || p_search || '%')
  ), latest_job as (
    select distinct on (j.worker_id) j.worker_id, j.dashboard_unpaid, j.unpaid_list_count, j.status::text as verification_status
    from public.verification_jobs j join public.verification_runs r on r.id = j.run_id
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

commit;
