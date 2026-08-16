-- Project Rekhya: record live GCS provider + access/control workflow migrations.
-- Live Supabase migration applied 2026-08-16.

begin;

alter table public.evidence_files drop constraint if exists evidence_files_storage_provider_check;
alter table public.evidence_files add constraint evidence_files_storage_provider_check
  check (storage_provider in ('supabase','cloudflare_r2','google_cloud_storage'));

create or replace function public.handle_new_officer_signup()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, display_name, role, active)
  values (new.id, coalesce(nullif(new.raw_user_meta_data->>'display_name',''), split_part(coalesce(new.email,''),'@',1)), 'pending'::officer_role, true)
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created_project_rekhya on auth.users;
create trigger on_auth_user_created_project_rekhya after insert on auth.users
for each row execute function public.handle_new_officer_signup();

insert into public.profiles(id, display_name, role, active)
select u.id, coalesce(nullif(u.raw_user_meta_data->>'display_name',''), split_part(coalesce(u.email,''),'@',1)), 'pending'::officer_role, true
from auth.users u left join public.profiles p on p.id=u.id where p.id is null;

create or replace function public.list_officer_access_requests()
returns table(user_id uuid, email text, display_name text, role officer_role, active boolean, created_at timestamptz)
language plpgsql security definer set search_path = public, auth, private as $$
begin
  if private.current_user_role() <> 'admin'::officer_role then raise exception 'Admin access required'; end if;
  return query select p.id, u.email::text, p.display_name, p.role, p.active, p.created_at
  from public.profiles p left join auth.users u on u.id=p.id
  order by case when p.role='pending'::officer_role then 0 else 1 end, p.created_at desc;
end; $$;

create or replace function public.approve_officer_access(p_user_id uuid, p_role officer_role, p_display_name text default null)
returns void language plpgsql security definer set search_path = public, private as $$
begin
  if private.current_user_role() <> 'admin'::officer_role then raise exception 'Admin access required'; end if;
  if p_role not in ('technical_officer'::officer_role,'field_officer'::officer_role,'auditor'::officer_role,'admin'::officer_role) then raise exception 'Unsupported officer role'; end if;
  update public.profiles set role=p_role, active=true, display_name=coalesce(nullif(trim(p_display_name),''),display_name), updated_at=now() where id=p_user_id;
  if not found then raise exception 'Officer profile not found'; end if;
end; $$;

create or replace function public.set_officer_access_state(p_user_id uuid, p_active boolean, p_role officer_role default null)
returns void language plpgsql security definer set search_path = public, private as $$
begin
  if private.current_user_role() <> 'admin'::officer_role then raise exception 'Admin access required'; end if;
  if p_user_id=auth.uid() and not p_active then raise exception 'You cannot deactivate your own admin session'; end if;
  update public.profiles set active=p_active, role=coalesce(p_role,role), updated_at=now() where id=p_user_id;
  if not found then raise exception 'Officer profile not found'; end if;
end; $$;

grant execute on function public.list_officer_access_requests() to authenticated;
grant execute on function public.approve_officer_access(uuid,officer_role,text) to authenticated;
grant execute on function public.set_officer_access_state(uuid,boolean,officer_role) to authenticated;

create or replace function public.enqueue_control_latest(p_command text)
returns uuid language plpgsql security definer set search_path=public, private as $$
declare v_run uuid; v_command uuid;
begin
  if private.current_user_role() not in ('admin'::officer_role,'technical_officer'::officer_role) then raise exception 'Technical access required'; end if;
  if p_command not in ('pause','stop_safely') then raise exception 'Unsupported control command'; end if;
  select r.id into v_run from public.verification_runs r
  where r.status in ('queued','running','paused') or exists(select 1 from public.verification_jobs j where j.run_id=r.id and j.status in ('queued','running','paused','pending','manual_review'))
  order by coalesce(r.started_at,r.created_at) desc limit 1;
  if v_run is null then raise exception 'No resumable verification run exists'; end if;
  insert into public.agent_commands(command,run_id,requested_by) values(p_command,v_run,auth.uid()) returning id into v_command;
  return v_command;
end; $$;
grant execute on function public.enqueue_control_latest(text) to authenticated;

create or replace function public.update_passport_for_verification(p_worker_id uuid, p_passport_reference text, p_note text default null)
returns uuid language plpgsql security definer set search_path=public, private as $$
declare v_id uuid;
begin
  if private.current_user_role() not in ('admin'::officer_role,'technical_officer'::officer_role,'field_officer'::officer_role) then raise exception 'Operational access required'; end if;
  if not exists(select 1 from public.workers w where w.id=p_worker_id and w.active=true and w.deleted_at is null) then raise exception 'Active worker not found'; end if;
  insert into public.passport_updates(worker_id,passport_reference,passport_status,note,verification_required,updated_by,updated_at,verified_by,verified_at)
  values(p_worker_id,nullif(trim(p_passport_reference),''),'updated',nullif(trim(p_note),''),true,auth.uid(),now(),null,null)
  on conflict(worker_id) do update set passport_reference=excluded.passport_reference, passport_status='updated', note=excluded.note, verification_required=true, updated_by=auth.uid(), updated_at=now(), verified_by=null, verified_at=null
  returning id into v_id;
  return v_id;
end; $$;
grant execute on function public.update_passport_for_verification(uuid,text,text) to authenticated;

create or replace function public.list_passport_workflow()
returns table(worker_id uuid,user_id text,name text,block text,group_name text,passport_reference text,passport_status text,note text,verification_required boolean,updated_at timestamptz,request_id uuid,request_status text)
language plpgsql security definer set search_path=public,private as $$
begin
  if private.current_user_role() not in ('admin'::officer_role,'technical_officer'::officer_role,'field_officer'::officer_role,'auditor'::officer_role) then raise exception 'Operational access required'; end if;
  return query
  select w.id,w.user_id,w.name,b.name,g.name,p.passport_reference,p.passport_status,p.note,coalesce(p.verification_required,false),p.updated_at,vr.id,vr.status
  from public.workers w
  left join public.blocks b on b.id=w.block_id
  left join public.worker_groups g on g.id=w.worker_group_id
  left join public.passport_updates p on p.worker_id=w.id
  left join lateral (select r.id,r.status from public.verification_requests r where r.worker_id=w.id and r.reason='passport_updated' order by r.created_at desc limit 1) vr on true
  where w.active=true and w.deleted_at is null
  order by coalesce(p.verification_required,false) desc,w.name,w.user_id;
end; $$;
grant execute on function public.list_passport_workflow() to authenticated;

commit;
