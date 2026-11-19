-- Run only against the disposable database used by CI/local verification.
begin;
do $$ begin
  if pg_catalog.current_database() <> 'shekelsync_usage_test' then
    raise exception 'These tests require the disposable shekelsync_usage_test database';
  end if;
end $$;
truncate shekelsync_usage.activity, shekelsync_usage.installations;

do $$ declare counts record; begin
  select * into counts from public.get_installation_activity_counts();
  assert counts.daily_active = 0 and counts.weekly_active = 0 and counts.monthly_active = 0, 'Empty data must yield zero counts';
  assert not pg_catalog.has_function_privilege('anon', 'public.get_installation_activity_counts()', 'execute'), 'Anonymous clients cannot read totals';
  assert not pg_catalog.has_schema_privilege('anon', 'shekelsync_usage', 'usage'), 'Private schema must not be exposed';
  assert (select bool_and(relrowsecurity) from pg_catalog.pg_class where relnamespace = 'shekelsync_usage'::regnamespace and relkind = 'r'), 'All activity tables must enable RLS';
end $$;

set local role anon;
select public.record_installation_activity('10000000-0000-4000-8000-000000000001', repeat('a', 64));
select public.record_installation_activity('10000000-0000-4000-8000-000000000001', repeat('a', 64));
do $$ begin
  perform public.record_installation_activity('10000000-0000-4000-8000-000000000001', repeat('b', 64));
  raise exception 'A different token must not reuse an installation';
exception when invalid_authorization_specification then null;
end $$;
do $$ begin
  perform public.record_installation_activity('10000000-0000-4000-8000-000000000002', 'short');
  raise exception 'Invalid tokens must be rejected';
exception when invalid_parameter_value then null;
end $$;
do $$ begin
  perform public.get_installation_activity_counts();
  raise exception 'Anonymous callers must not read totals';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  perform 1 from shekelsync_usage.installations;
  raise exception 'Anonymous callers must not read installation identities';
exception when insufficient_privilege then null;
end $$;
select public.forget_installation_activity('10000000-0000-4000-8000-000000000001', repeat('b', 64));
reset role;
do $$ begin
  assert (select count(*) from shekelsync_usage.activity) = 1, 'Repeated reports must count once and a wrong token cannot delete activity';
  assert (select octet_length(token_hash) from shekelsync_usage.installations) = 32, 'Only the SHA-256 token hash is stored';
end $$;

set local role anon;
select public.record_installation_activity('10000000-0000-4000-8000-000000000002', repeat('b', 64));
select public.record_installation_activity('10000000-0000-4000-8000-000000000003', repeat('c', 64));
select public.record_installation_activity('10000000-0000-4000-8000-000000000004', repeat('d', 64));
select public.record_installation_activity('10000000-0000-4000-8000-000000000005', repeat('e', 64));
reset role;
update shekelsync_usage.activity set active_day = active_day - 6 where installation_id = '10000000-0000-4000-8000-000000000002';
update shekelsync_usage.activity set active_day = active_day - 29 where installation_id = '10000000-0000-4000-8000-000000000003';
update shekelsync_usage.activity set active_day = active_day - 30 where installation_id = '10000000-0000-4000-8000-000000000004';
update shekelsync_usage.activity set active_day = active_day - 7 where installation_id = '10000000-0000-4000-8000-000000000005';
insert into shekelsync_usage.activity values ('10000000-0000-4000-8000-000000000001', timezone('UTC', statement_timestamp())::date - 1);
do $$ declare counts record; begin
  select * into counts from public.get_installation_activity_counts();
  assert counts.daily_active = 1, 'Daily count must use the current UTC day';
  assert counts.weekly_active = 2, 'Weekly count must deduplicate IDs over exactly seven days';
  assert counts.monthly_active = 4, 'Monthly count must deduplicate IDs over exactly 30 days';
end $$;

set local role service_role;
select * from public.get_installation_activity_counts();
reset role;
update shekelsync_usage.installations set revoked = true where installation_id = '10000000-0000-4000-8000-000000000005';
do $$ declare counts record; begin
  select * into counts from public.get_installation_activity_counts();
  assert counts.monthly_active = 3, 'Revoked identities must never contribute to totals';
end $$;

set local role anon;
select public.forget_installation_activity('10000000-0000-4000-8000-000000000001', repeat('a', 64));
do $$ begin
  perform public.record_installation_activity('10000000-0000-4000-8000-000000000001', repeat('a', 64));
  raise exception 'A delayed report must not restore revoked activity';
exception when invalid_authorization_specification then null;
end $$;
-- Revocation must also win when it reaches the server before an in-flight report.
select public.forget_installation_activity('10000000-0000-4000-8000-000000000006', repeat('f', 64));
do $$ begin
  perform public.record_installation_activity('10000000-0000-4000-8000-000000000006', repeat('f', 64));
  raise exception 'A late first report must not restore revoked activity';
exception when invalid_authorization_specification then null;
end $$;
reset role;
do $$ begin
  assert not exists (select 1 from shekelsync_usage.activity where installation_id = '10000000-0000-4000-8000-000000000001'), 'Revocation removes counting history';
end $$;

update shekelsync_usage.activity set active_day = timezone('UTC', statement_timestamp())::date - 90
where installation_id = '10000000-0000-4000-8000-000000000004';
update shekelsync_usage.installations set last_seen_day = timezone('UTC', statement_timestamp())::date - 90
where installation_id = '10000000-0000-4000-8000-000000000004';
select shekelsync_usage.prune_activity();
do $$ begin
  assert not exists (select 1 from shekelsync_usage.activity where active_day < timezone('UTC', statement_timestamp())::date - 89), 'Expired activity must be pruned';
  assert not exists (select 1 from shekelsync_usage.installations where installation_id = '10000000-0000-4000-8000-000000000004'), 'Inactive identities must expire';
end $$;
rollback;
