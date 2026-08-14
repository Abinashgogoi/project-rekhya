begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create index if not exists workers_deleted_by_idx
  on public.workers(deleted_by)
  where deleted_by is not null;

create index if not exists source_files_deleted_by_idx
  on public.source_files(deleted_by)
  where deleted_by is not null;

commit;
