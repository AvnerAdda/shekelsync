-- Hosted Supabase only; never apply to the local financial database.
-- Schedule the separate retention job before enabling desktop reporting.
begin;

create schema if not exists shekelsync_usage;
revoke all on schema shekelsync_usage from public, anon, authenticated;

create table if not exists shekelsync_usage.installations (
  installation_id uuid primary key,
  token_hash bytea not null,
  revoked boolean not null default false,
  last_seen_day date not null
);
create table if not exists shekelsync_usage.activity (
  installation_id uuid not null references shekelsync_usage.installations on delete cascade,
  active_day date not null,
  primary key (installation_id, active_day)
);
create index if not exists installation_activity_day_idx on shekelsync_usage.activity (active_day);
alter table shekelsync_usage.installations enable row level security;
alter table shekelsync_usage.activity enable row level security;
revoke all on all tables in schema shekelsync_usage from public, anon, authenticated;

create or replace function shekelsync_usage.prune_activity()
returns void language sql security definer set search_path = '' as $$
  delete from shekelsync_usage.activity
  where active_day < (pg_catalog.timezone('UTC', pg_catalog.statement_timestamp())::date - 89);
  delete from shekelsync_usage.installations
  where last_seen_day < (pg_catalog.timezone('UTC', pg_catalog.statement_timestamp())::date - 89);
$$;
revoke all on function shekelsync_usage.prune_activity() from public, anon, authenticated;

create or replace function public.record_installation_activity(p_installation_id uuid, p_token text)
returns date language plpgsql security definer set search_path = '' as $$
declare
  activity_day date := pg_catalog.timezone('UTC', pg_catalog.statement_timestamp())::date;
  expected_hash bytea;
begin
  if p_installation_id is null or p_installation_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid activity credentials' using errcode = '22023';
  end if;
  expected_hash := pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8'));
  insert into shekelsync_usage.installations as existing (installation_id, token_hash, last_seen_day)
  values (p_installation_id, expected_hash, activity_day)
  on conflict (installation_id) do update set last_seen_day = excluded.last_seen_day
  where existing.token_hash = excluded.token_hash and not existing.revoked;
  if not found then
    raise exception 'Invalid activity credentials' using errcode = '28000';
  end if;
  insert into shekelsync_usage.activity (installation_id, active_day)
  values (p_installation_id, activity_day) on conflict do nothing;
  return activity_day;
end;
$$;

create or replace function public.forget_installation_activity(p_installation_id uuid, p_token text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  expected_hash bytea;
begin
  if p_installation_id is null or p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid activity credentials' using errcode = '22023';
  end if;
  expected_hash := pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8'));
  -- Retain a revocation marker so a delayed in-flight report cannot recreate
  -- activity after deletion. Both the ID and hashed token expire after 90 days.
  insert into shekelsync_usage.installations as existing (installation_id, token_hash, revoked, last_seen_day)
  values (p_installation_id, expected_hash, true, pg_catalog.timezone('UTC', pg_catalog.statement_timestamp())::date)
  on conflict (installation_id) do update set revoked = true, last_seen_day = excluded.last_seen_day
  where existing.token_hash = excluded.token_hash;
  delete from shekelsync_usage.activity as activity
  using shekelsync_usage.installations as installation
  where activity.installation_id = p_installation_id
    and installation.installation_id = activity.installation_id
    and installation.token_hash = expected_hash and installation.revoked;
end;
$$;

create or replace function public.get_installation_activity_counts()
returns table (as_of date, daily_active bigint, weekly_active bigint, monthly_active bigint)
language sql stable security definer set search_path = '' as $$
  select pg_catalog.timezone('UTC', pg_catalog.statement_timestamp())::date,
    count(distinct activity.installation_id) filter (where activity.active_day = pg_catalog.timezone('UTC', pg_catalog.statement_timestamp())::date),
    count(distinct activity.installation_id) filter (where activity.active_day >= pg_catalog.timezone('UTC', pg_catalog.statement_timestamp())::date - 6),
    count(distinct activity.installation_id)
  from shekelsync_usage.activity as activity
  join shekelsync_usage.installations as installation using (installation_id)
  where not installation.revoked
    and activity.active_day between pg_catalog.timezone('UTC', pg_catalog.statement_timestamp())::date - 29
      and pg_catalog.timezone('UTC', pg_catalog.statement_timestamp())::date;
$$;

revoke all on function public.record_installation_activity(uuid, text) from public, anon, authenticated;
revoke all on function public.forget_installation_activity(uuid, text) from public, anon, authenticated;
revoke all on function public.get_installation_activity_counts() from public, anon, authenticated;
grant execute on function public.record_installation_activity(uuid, text) to anon, authenticated;
grant execute on function public.forget_installation_activity(uuid, text) to anon, authenticated;
grant execute on function public.get_installation_activity_counts() to service_role;

notify pgrst, 'reload schema';
commit;
