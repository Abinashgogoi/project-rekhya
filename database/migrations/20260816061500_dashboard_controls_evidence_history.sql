begin;

create or replace function public.restart_verification_from_beginning(p_start date,p_end date)
returns uuid
language plpgsql
security definer
set search_path=public,private
as $$
declare v_status text; v_run uuid;
begin
  if private.current_user_role() not in ('admin'::officer_role,'technical_officer'::officer_role) then raise exception 'Technical access required'; end if;
  if p_start is null or p_end is null or p_start>p_end then raise exception 'Invalid inclusive date range'; end if;
  select status into v_status from public.agent_status where singleton=true;
  if coalesce(v_status,'idle') not in ('idle','disconnected') then raise exception 'Agent must be idle before restarting from the beginning'; end if;
  if exists(select 1 from public.agent_commands where status in ('queued','accepted')) then raise exception 'An agent command is already pending'; end if;
  v_run := public.queue_verification_run(p_start,p_end);
  return v_run;
end;
$$;
grant execute on function public.restart_verification_from_beginning(date,date) to authenticated;

drop policy if exists passport_updates_insert on public.passport_updates;
drop policy if exists passport_updates_update on public.passport_updates;

create policy passport_updates_insert on public.passport_updates
for insert to authenticated
with check (
  private.current_user_role() in ('admin'::officer_role,'technical_officer'::officer_role)
  and updated_by=auth.uid()
);

create policy passport_updates_update on public.passport_updates
for update to authenticated
using (private.current_user_role() in ('admin'::officer_role,'technical_officer'::officer_role))
with check (
  private.current_user_role() in ('admin'::officer_role,'technical_officer'::officer_role)
  and updated_by=auth.uid()
);

create or replace function public.list_passport_workflow()
returns table(worker_id uuid,user_id text,name text,block text,group_name text,passport_reference text,passport_status text,note text,verification_required boolean,updated_at timestamptz,request_id uuid,request_status text)
language plpgsql
security definer
set search_path=public,private
as $$
begin
  if private.current_user_role() not in ('admin'::officer_role,'technical_officer'::officer_role,'field_officer'::officer_role,'auditor'::officer_role) then
    raise exception 'Operational access required';
  end if;
  return query
  select w.id,w.user_id,w.name,b.name,g.name,
         p.passport_reference,p.passport_status,p.note,coalesce(p.verification_required,false),p.updated_at,
         vr.id,vr.status
  from public.workers w
  left join public.blocks b on b.id=w.block_id
  left join public.worker_groups g on g.id=w.worker_group_id
  left join public.passport_updates p on p.worker_id=w.id
  left join lateral (
    select r.id,r.status from public.verification_requests r
    where r.worker_id=w.id and r.reason='passport_updated'
    order by r.created_at desc limit 1
  ) vr on true
  where w.active=true and w.deleted_at is null and w.source_deleted_by_file_id is null
  order by coalesce(p.verification_required,false) desc,w.name,w.user_id;
end;
$$;
grant execute on function public.list_passport_workflow() to authenticated;

with latest as (
  select distinct on (worker_id) worker_id,run_id
  from public.evidence_files
  where run_id is not null
  order by worker_id,captured_at desc
)
update public.evidence_files ef
set run_scope=case when ef.run_id=l.run_id then 'current' else 'previous' end
from latest l
where ef.worker_id=l.worker_id;

update public.evidence_files set run_scope='previous' where run_id is null;

commit;
