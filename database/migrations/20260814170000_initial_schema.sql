begin;

create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

do $$ begin create type public.officer_role as enum ('admin','technical_officer','field_officer','auditor','pending'); exception when duplicate_object then null; end $$;
do $$ begin create type public.source_type as enum ('master','portal'); exception when duplicate_object then null; end $$;
do $$ begin create type public.import_status as enum ('queued','processing','processed','processed_with_warnings','failed'); exception when duplicate_object then null; end $$;
do $$ begin create type public.job_status as enum ('queued','running','paused','ok','pending','manual_review','failed','stopped'); exception when duplicate_object then null; end $$;
do $$ begin create type public.issue_type as enum ('password','network_server','wrong_id','count_mismatch','possible_duplicate','uncertain_read','device','other'); exception when duplicate_object then null; end $$;
do $$ begin create type public.group_type as enum ('krishi_sakhi','vendor'); exception when duplicate_object then null; end $$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  role public.officer_role not null default 'pending',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.blocks (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.worker_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.worker_groups(name) values ('Krishi Sakhi'), ('Vendor') on conflict (name) do nothing;

create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  source_type public.source_type not null,
  source_label text not null,
  status public.import_status not null default 'queued',
  uploaded_by uuid not null references auth.users(id),
  file_count integer not null default 0 check (file_count >= 0),
  detected_start_date date,
  detected_end_date date,
  warning_count integer not null default 0 check (warning_count >= 0),
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  check (detected_start_date is null or detected_end_date is null or detected_start_date <= detected_end_date)
);

create table public.source_files (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.import_batches(id) on delete cascade,
  original_filename text not null,
  sha256 text not null,
  mime_type text,
  row_count integer not null default 0 check (row_count >= 0),
  accepted_row_count integer not null default 0 check (accepted_row_count >= 0),
  ignored_out_of_scope_count integer not null default 0 check (ignored_out_of_scope_count >= 0),
  duplicate_row_count integer not null default 0 check (duplicate_row_count >= 0),
  detected_start_date date,
  detected_end_date date,
  header_map jsonb not null default '{}'::jsonb,
  processing_status public.import_status not null default 'queued',
  created_at timestamptz not null default now(),
  unique(batch_id, sha256),
  check (detected_start_date is null or detected_end_date is null or detected_start_date <= detected_end_date)
);

create table public.workers (
  id uuid primary key default gen_random_uuid(),
  user_id text not null unique check (length(trim(user_id)) > 0),
  name text not null check (length(trim(name)) > 0),
  block_id uuid references public.blocks(id),
  worker_group_id uuid references public.worker_groups(id),
  active boolean not null default true,
  latest_master_file_id uuid references public.source_files(id),
  master_row_number integer,
  extra_fields jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index workers_user_id_idx on public.workers(user_id);
create index workers_name_search_idx on public.workers using gin (to_tsvector('simple', name));
create index workers_scope_idx on public.workers(block_id, worker_group_id) where active;

create table public.worker_credentials (
  worker_id uuid primary key references public.workers(id) on delete cascade,
  password_ciphertext text not null,
  cipher_version smallint not null default 1,
  source_file_id uuid references public.source_files(id),
  source_row_number integer,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

create table public.portal_records (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.workers(id),
  source_file_id uuid not null references public.source_files(id) on delete restrict,
  source_row_number integer not null check (source_row_number > 0),
  row_fingerprint text not null,
  transaction_date date not null,
  amount numeric(14,2),
  policy_id text,
  applicant_name text,
  status text,
  raw_fields jsonb not null default '{}'::jsonb,
  imported_at timestamptz not null default now(),
  unique(source_file_id, source_row_number),
  unique(source_file_id, row_fingerprint)
);

create index portal_records_worker_date_idx on public.portal_records(worker_id, transaction_date);
create index portal_records_policy_idx on public.portal_records(policy_id) where policy_id is not null;

create table public.import_conflicts (
  id uuid primary key default gen_random_uuid(),
  source_file_id uuid not null references public.source_files(id) on delete cascade,
  conflicting_file_id uuid references public.source_files(id) on delete set null,
  conflict_type text not null,
  row_fingerprint text,
  detail jsonb not null default '{}'::jsonb,
  resolution text,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.verification_runs (
  id uuid primary key default gen_random_uuid(),
  start_date date not null,
  end_date date not null,
  default_cutoff date not null default date '2026-07-31',
  status public.job_status not null default 'queued',
  started_by uuid not null references auth.users(id),
  device_serial text,
  app_package text,
  selected_state text not null default 'ASSAM',
  selected_season text not null default 'Kharif',
  selected_scheme text not null default 'PMFBY',
  selected_year integer not null default 2026,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  check (start_date <= end_date)
);

create table public.verification_jobs (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.verification_runs(id) on delete cascade,
  worker_id uuid not null references public.workers(id),
  queue_position integer not null check (queue_position > 0),
  status public.job_status not null default 'queued',
  issue_type public.issue_type,
  current_stage text,
  expected_user_id text not null,
  displayed_user_id text,
  displayed_name text,
  password_attempts smallint not null default 0 check (password_attempts between 0 and 2),
  transient_attempts smallint not null default 0 check (transient_attempts between 0 and 4),
  final_retry_attempted boolean not null default false,
  dashboard_unpaid integer check (dashboard_unpaid >= 0),
  unpaid_list_count integer check (unpaid_list_count >= 0),
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  unique(run_id, worker_id),
  unique(run_id, queue_position)
);

create index verification_jobs_status_idx on public.verification_jobs(run_id, status, queue_position);

create table public.app_records (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.verification_runs(id) on delete cascade,
  job_id uuid not null references public.verification_jobs(id) on delete cascade,
  worker_id uuid not null references public.workers(id),
  policy_id text,
  applicant_name text,
  amount numeric(14,2) not null check (amount >= 0),
  application_date date not null,
  status text,
  list_position integer,
  evidence_sequence integer,
  possible_duplicate boolean not null default false,
  review_reason text,
  captured_at timestamptz not null default now()
);

create index app_records_worker_date_idx on public.app_records(worker_id, application_date);
create index app_records_duplicate_review_idx on public.app_records(worker_id, policy_id, applicant_name, amount, application_date) where possible_duplicate;

create table public.app_summaries (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.verification_runs(id) on delete cascade,
  worker_id uuid not null references public.workers(id),
  start_date date not null,
  end_date date not null,
  normal_total integer not null default 0 check (normal_total >= 0),
  high_total integer not null default 0 check (high_total >= 0),
  app_entry integer generated always as (normal_total + high_total) stored,
  dashboard_unpaid integer check (dashboard_unpaid >= 0),
  unpaid_list_count integer check (unpaid_list_count >= 0),
  pre_cutoff_count integer not null default 0 check (pre_cutoff_count >= 0),
  status public.job_status not null,
  issue_type public.issue_type,
  created_at timestamptz not null default now(),
  unique(run_id, worker_id, start_date, end_date),
  check (start_date <= end_date)
);

create table public.evidence_files (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.workers(id),
  run_id uuid references public.verification_runs(id) on delete cascade,
  job_id uuid references public.verification_jobs(id) on delete cascade,
  app_record_id uuid references public.app_records(id) on delete set null,
  category text not null,
  storage_bucket text not null default 'project-rekhya-evidence',
  storage_path text not null unique,
  original_filename text not null,
  mime_type text not null,
  sha256 text not null,
  captured_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id)
);

create index evidence_files_worker_idx on public.evidence_files(worker_id, run_id, category);

create table public.payment_records (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.workers(id) on delete cascade,
  group_type public.group_type not null,
  amount_received numeric(14,2) check (amount_received is null or amount_received >= 0),
  pending_amount numeric(14,2) check (pending_amount is null or pending_amount >= 0),
  note text,
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now(),
  unique(worker_id, group_type)
);

create table public.reconciliation_snapshots (
  id uuid primary key default gen_random_uuid(),
  start_date date not null,
  end_date date not null,
  filters jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check (start_date <= end_date)
);

create table public.reconciliation_rows (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.reconciliation_snapshots(id) on delete cascade,
  worker_id uuid not null references public.workers(id),
  portal_entry integer not null check (portal_entry >= 0),
  normal_total integer not null check (normal_total >= 0),
  high_entry integer not null check (high_entry >= 0),
  app_entry integer not null check (app_entry = normal_total + high_entry),
  status text,
  source_trace jsonb not null,
  unique(snapshot_id, worker_id)
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid references public.workers(id),
  job_id uuid references public.verification_jobs(id) on delete cascade,
  severity text not null check (severity in ('info','warning','critical')),
  channel text not null check (channel in ('dashboard','email','whatsapp')),
  dedupe_key text not null,
  title text not null,
  message text not null,
  status text not null default 'queued' check (status in ('queued','sent','failed','acknowledged')),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  acknowledged_by uuid references auth.users(id),
  unique(channel, dedupe_key)
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id),
  action text not null,
  entity_type text not null,
  entity_id text,
  before_data jsonb,
  after_data jsonb,
  source text not null default 'dashboard',
  created_at timestamptz not null default now()
);

create index audit_logs_entity_idx on public.audit_logs(entity_type, entity_id, created_at desc);
create index audit_logs_actor_idx on public.audit_logs(actor_id, created_at desc);

create table public.agent_status (
  singleton boolean primary key default true check (singleton),
  device_connected boolean not null default false,
  adb_authorized boolean not null default false,
  sim_detected boolean not null default false,
  official_app_ready boolean not null default false,
  cloud_sync_connected boolean not null default false,
  status text not null default 'disconnected' check (status in ('idle','running','paused','disconnected')),
  total_ids integer not null default 0,
  completed_ids integer not null default 0,
  running_ids integer not null default 0,
  password_pending integer not null default 0,
  network_pending integer not null default 0,
  current_user_id text,
  current_stage text,
  heartbeat_at timestamptz,
  updated_at timestamptz not null default now()
);

insert into public.agent_status(singleton) values (true) on conflict (singleton) do nothing;

create or replace function private.current_user_role() returns public.officer_role
language plpgsql stable security definer set search_path = '' as $$
declare result public.officer_role;
begin
  if auth.uid() is null then return null; end if;
  select p.role into result from public.profiles p where p.id = auth.uid() and p.active;
  return result;
end;
$$;
revoke all on function private.current_user_role() from public, anon;
grant execute on function private.current_user_role() to authenticated;

create or replace function private.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end;
$$;
revoke all on function private.set_updated_at() from public, anon;

create trigger profiles_updated_at before update on public.profiles for each row execute function private.set_updated_at();
create trigger workers_updated_at before update on public.workers for each row execute function private.set_updated_at();
create trigger credentials_updated_at before update on public.worker_credentials for each row execute function private.set_updated_at();
create trigger payment_updated_at before update on public.payment_records for each row execute function private.set_updated_at();
create trigger agent_status_updated_at before update on public.agent_status for each row execute function private.set_updated_at();

create or replace function private.audit_payment_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, before_data, after_data)
  values (auth.uid(), tg_op, 'payment_record', coalesce(new.id, old.id)::text, case when tg_op = 'INSERT' then null else to_jsonb(old) end, case when tg_op = 'DELETE' then null else to_jsonb(new) end);
  return coalesce(new, old);
end;
$$;
revoke all on function private.audit_payment_change() from public, anon, authenticated;
create trigger audit_payment_records after insert or update or delete on public.payment_records for each row execute function private.audit_payment_change();

create or replace function private.audit_credential_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, before_data, after_data)
  values (auth.uid(), tg_op, 'worker_credential', coalesce(new.worker_id, old.worker_id)::text,
    case when tg_op = 'INSERT' then null else jsonb_build_object('worker_id', old.worker_id, 'source_file_id', old.source_file_id, 'updated_at', old.updated_at) end,
    case when tg_op = 'DELETE' then null else jsonb_build_object('worker_id', new.worker_id, 'source_file_id', new.source_file_id, 'updated_at', new.updated_at) end);
  return coalesce(new, old);
end;
$$;
revoke all on function private.audit_credential_change() from public, anon, authenticated;
create trigger audit_worker_credentials after insert or update or delete on public.worker_credentials for each row execute function private.audit_credential_change();

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
    (select count(*) from public.portal_records pr where pr.worker_id=e.id and pr.transaction_date between p_start and p_end),
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

revoke all on function public.get_reconciliation_report(date,date,text,text,text) from public, anon;
grant execute on function public.get_reconciliation_report(date,date,text,text,text) to authenticated;

alter table public.profiles enable row level security;
alter table public.blocks enable row level security;
alter table public.worker_groups enable row level security;
alter table public.import_batches enable row level security;
alter table public.source_files enable row level security;
alter table public.workers enable row level security;
alter table public.worker_credentials enable row level security;
alter table public.portal_records enable row level security;
alter table public.import_conflicts enable row level security;
alter table public.verification_runs enable row level security;
alter table public.verification_jobs enable row level security;
alter table public.app_records enable row level security;
alter table public.app_summaries enable row level security;
alter table public.evidence_files enable row level security;
alter table public.payment_records enable row level security;
alter table public.reconciliation_snapshots enable row level security;
alter table public.reconciliation_rows enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;
alter table public.agent_status enable row level security;

create policy profiles_self_read on public.profiles for select to authenticated using (id = (select auth.uid()) or private.current_user_role() in ('admin','technical_officer'));
create policy profiles_admin_manage on public.profiles for all to authenticated using (private.current_user_role()='admin') with check (private.current_user_role()='admin');

create policy operational_reference_read on public.blocks for select to authenticated using (private.current_user_role() in ('admin','technical_officer','field_officer','auditor'));
create policy operational_group_read on public.worker_groups for select to authenticated using (private.current_user_role() in ('admin','technical_officer','field_officer','auditor'));
create policy reference_admin_write on public.blocks for all to authenticated using (private.current_user_role() in ('admin','technical_officer')) with check (private.current_user_role() in ('admin','technical_officer'));
create policy group_admin_write on public.worker_groups for all to authenticated using (private.current_user_role() in ('admin','technical_officer')) with check (private.current_user_role() in ('admin','technical_officer'));

create policy workers_operational_read on public.workers for select to authenticated using (private.current_user_role() in ('admin','technical_officer','field_officer','auditor'));
create policy workers_technical_write on public.workers for all to authenticated using (private.current_user_role() in ('admin','technical_officer')) with check (private.current_user_role() in ('admin','technical_officer'));
create policy credentials_authorized_read on public.worker_credentials for select to authenticated using (private.current_user_role() in ('admin','technical_officer','field_officer'));
create policy credentials_technical_write on public.worker_credentials for all to authenticated using (private.current_user_role() in ('admin','technical_officer')) with check (private.current_user_role() in ('admin','technical_officer'));

create policy imports_operational_read on public.import_batches for select to authenticated using (private.current_user_role() in ('admin','technical_officer','field_officer','auditor'));
create policy imports_technical_write on public.import_batches for all to authenticated using (private.current_user_role() in ('admin','technical_officer')) with check (private.current_user_role() in ('admin','technical_officer'));
create policy files_operational_read on public.source_files for select to authenticated using (private.current_user_role() in ('admin','technical_officer','field_officer','auditor'));
create policy files_technical_write on public.source_files for all to authenticated using (private.current_user_role() in ('admin','technical_officer')) with check (private.current_user_role() in ('admin','technical_officer'));
create policy portal_operational_read on public.portal_records for select to authenticated using (private.current_user_role() in ('admin','technical_officer','field_officer','auditor'));
create policy portal_technical_write on public.portal_records for all to authenticated using (private.current_user_role() in ('admin','technical_officer')) with check (private.current_user_role() in ('admin','technical_officer'));
create policy conflicts_operational_read on public.import_conflicts for select to authenticated using (private.current_user_role() in ('admin','technical_officer','field_officer','auditor'));
create policy conflicts_technical_write on public.import_conflicts for all to authenticated using (private.current_user_role() in ('admin','technical_officer')) with check (private.current_user_role() in ('admin','technical_officer'));

create policy runs_operational_read on public.verification_runs for select to authenticated using (private.current_user_role() in ('admin','technical_officer','field_officer','auditor'));
create policy runs_technical_write on public.verification_runs for all to authenticated using (private.current_user_role() in ('admin','technical_officer')) with check (private.current_user_role() in ('admin','technical_officer'));
create policy jobs_operational_read on public.verification_jobs for select to authenticated using (private.current_user_role() in ('admin','technical_officer','field_officer','auditor'));
create policy jobs_technical_write on public.verification_jobs for all to authenticated using (private.current_user_role() in ('admin','technical_officer')) with check (private.current_user_role() in ('admin','technical_officer'));
create policy app_records_operational_read on public.app_records for select to authenticated using (private.current_user_role() in ('admin','technical_officer','field_officer','auditor'));
create policy app_records_technical_write on public.app_records for all to authenticated using (private.current_user_role() in ('admin','technical_officer')) with check (private.current_user_role() in ('admin','technical_officer'));
create policy app_summaries_operational_read on public.app_summaries for select to authenticated using (private.current_user_role() in ('admin','technical_officer','field_officer','auditor'));
create policy app_summaries_technical_write on public.app_summaries for all to authenticated using (private.current_user_role() in ('admin','technical_officer')) with check (private.current_user_role() in ('admin','technical_officer'));

create policy evidence_operational_read on public.evidence_files for select to authenticated using (private.current_user_role() in ('admin','technical_officer','field_officer','auditor'));
create policy evidence_technical_write on public.evidence_files for all to authenticated using (private.current_user_role() in ('admin','technical_officer')) with check (private.current_user_role() in ('admin','technical_officer'));
create policy payments_operational_read on public.payment_records for select to authenticated using (private.current_user_role() in ('admin','technical_officer','field_officer','auditor'));
create policy payments_operational_write on public.payment_records for all to authenticated using (private.current_user_role() in ('admin','technical_officer','field_officer')) with check (private.current_user_role() in ('admin','technical_officer','field_officer') and updated_by=(select auth.uid()));
create policy snapshots_operational_read on public.reconciliation_snapshots for select to authenticated using (private.current_user_role() in ('admin','technical_officer','field_officer','auditor'));
create policy snapshots_technical_write on public.reconciliation_snapshots for all to authenticated using (private.current_user_role() in ('admin','technical_officer')) with check (private.current_user_role() in ('admin','technical_officer'));
create policy rows_operational_read on public.reconciliation_rows for select to authenticated using (private.current_user_role() in ('admin','technical_officer','field_officer','auditor'));
create policy rows_technical_write on public.reconciliation_rows for all to authenticated using (private.current_user_role() in ('admin','technical_officer')) with check (private.current_user_role() in ('admin','technical_officer'));
create policy notifications_operational_read on public.notifications for select to authenticated using (private.current_user_role() in ('admin','technical_officer','field_officer','auditor'));
create policy notifications_technical_write on public.notifications for all to authenticated using (private.current_user_role() in ('admin','technical_officer')) with check (private.current_user_role() in ('admin','technical_officer'));
create policy audit_authorized_read on public.audit_logs for select to authenticated using (private.current_user_role() in ('admin','technical_officer','auditor'));
create policy agent_operational_read on public.agent_status for select to authenticated using (private.current_user_role() in ('admin','technical_officer','field_officer','auditor'));
create policy agent_technical_write on public.agent_status for all to authenticated using (private.current_user_role() in ('admin','technical_officer')) with check (private.current_user_role() in ('admin','technical_officer'));

grant select on public.profiles, public.blocks, public.worker_groups, public.import_batches, public.source_files, public.workers, public.worker_credentials, public.portal_records, public.import_conflicts, public.verification_runs, public.verification_jobs, public.app_records, public.app_summaries, public.evidence_files, public.payment_records, public.reconciliation_snapshots, public.reconciliation_rows, public.notifications, public.audit_logs, public.agent_status to authenticated;
grant insert, update, delete on public.profiles, public.blocks, public.worker_groups, public.import_batches, public.source_files, public.workers, public.worker_credentials, public.portal_records, public.import_conflicts, public.verification_runs, public.verification_jobs, public.app_records, public.app_summaries, public.evidence_files, public.payment_records, public.reconciliation_snapshots, public.reconciliation_rows, public.notifications, public.agent_status to authenticated;
grant usage, select on sequence public.audit_logs_id_seq to authenticated;
revoke all on all tables in schema public from anon;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('project-rekhya-evidence','project-rekhya-evidence',false,10485760,array['image/png','image/jpeg','application/json','application/zip'])
on conflict (id) do update set public=false, file_size_limit=excluded.file_size_limit, allowed_mime_types=excluded.allowed_mime_types;

create policy evidence_storage_read on storage.objects for select to authenticated using (bucket_id='project-rekhya-evidence' and private.current_user_role() in ('admin','technical_officer','field_officer','auditor'));
create policy evidence_storage_insert on storage.objects for insert to authenticated with check (bucket_id='project-rekhya-evidence' and private.current_user_role() in ('admin','technical_officer'));
create policy evidence_storage_update on storage.objects for update to authenticated using (bucket_id='project-rekhya-evidence' and private.current_user_role() in ('admin','technical_officer')) with check (bucket_id='project-rekhya-evidence' and private.current_user_role() in ('admin','technical_officer'));
create policy evidence_storage_delete on storage.objects for delete to authenticated using (bucket_id='project-rekhya-evidence' and private.current_user_role() in ('admin','technical_officer'));

alter publication supabase_realtime add table public.payment_records;
alter publication supabase_realtime add table public.verification_jobs;
alter publication supabase_realtime add table public.app_records;
alter publication supabase_realtime add table public.portal_records;
alter publication supabase_realtime add table public.evidence_files;
alter publication supabase_realtime add table public.notifications;
alter publication supabase_realtime add table public.agent_status;

commit;
