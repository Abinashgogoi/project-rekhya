insert into public.worker_groups(name)
values ('SeSTA')
on conflict (name) do update set active = true;
