-- Supabase schema for ShekelSync (waitlist + licenses).
-- Run this in Supabase SQL editor as the database owner.

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- =========================
-- Waitlist (marketing site)
-- =========================
create table if not exists public.waitlist (
  id uuid primary key default uuid_generate_v4(),
  email varchar(255) unique not null,
  name varchar(100) not null,

  -- Use case
  use_case varchar(20) check (use_case in ('personal', 'business', 'freelancer', 'family', 'other')),
  use_case_other text,

  -- Banks and credit cards (stored as JSON arrays)
  banks jsonb not null default '[]'::jsonb,
  banks_other text,
  credit_cards jsonb not null default '[]'::jsonb,
  credit_cards_other text,
  investment_types jsonb not null default '[]'::jsonb,

  -- Referral
  referral_code varchar(50),
  own_referral_code varchar(10) unique,

  -- Metadata
  language varchar(2) default 'he',
  created_at timestamptz not null default now(),
  confirmed_email boolean not null default false,
  waitlist_position serial,

  -- Conversion tracking
  notified_at_launch timestamptz,
  converted_to_customer boolean not null default false,

  -- Validation
  constraint valid_email check (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$')
);

create index if not exists idx_waitlist_email on public.waitlist(email);
create index if not exists idx_waitlist_created_at on public.waitlist(created_at desc);
create index if not exists idx_waitlist_position on public.waitlist(waitlist_position);
create index if not exists idx_waitlist_referral_code on public.waitlist(own_referral_code);

alter table public.waitlist enable row level security;

create policy "Allow public insert" on public.waitlist
  for insert
  with check (true);

create policy "Allow public count" on public.waitlist
  for select
  using (true);

create or replace function public.generate_referral_code()
returns text
language plpgsql
as $$
declare
  characters text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  result text := '';
  i integer;
begin
  for i in 1..6 loop
    result := result || substr(characters, floor(random() * length(characters) + 1)::int, 1);
  end loop;
  return result;
end;
$$;

create or replace function public.set_referral_code()
returns trigger
language plpgsql
as $$
begin
  if new.own_referral_code is null then
    new.own_referral_code := generate_referral_code();
  end if;
  return new;
end;
$$;

drop trigger if exists before_insert_waitlist on public.waitlist;
create trigger before_insert_waitlist
  before insert on public.waitlist
  for each row
  execute function public.set_referral_code();

-- ======================
-- Licenses (Electron app)
-- ======================
create table if not exists public.licenses (
  id uuid primary key default uuid_generate_v4(),
  unique_id uuid not null unique,
  teudat_zehut varchar(9) not null,
  device_hash text not null,
  device_name text,
  installation_date timestamptz not null default now(),
  trial_start_date timestamptz not null default now(),
  subscription_date timestamptz,
  license_status text not null default 'trial' check (license_status in ('trial', 'active', 'expired')),
  last_validated_at timestamptz,
  app_version text,
  os_platform text,
  payment_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint valid_teudat_zehut check (teudat_zehut ~ '^\\d{9}$')
);

create unique index if not exists idx_licenses_teudat_zehut on public.licenses(teudat_zehut);
create index if not exists idx_licenses_unique_id on public.licenses(unique_id);

alter table public.licenses enable row level security;

create policy "Allow public license insert" on public.licenses
  for insert
  with check (true);

create policy "Allow public license select" on public.licenses
  for select
  using (true);

create policy "Allow public license update" on public.licenses
  for update
  using (true)
  with check (true);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists set_licenses_updated_at on public.licenses;
create trigger set_licenses_updated_at
  before update on public.licenses
  for each row
  execute function public.set_updated_at();

create or replace function public.block_duplicate_teudat_zehut()
returns trigger
language plpgsql
as $$
begin
  if exists (select 1 from public.licenses where teudat_zehut = new.teudat_zehut) then
    raise exception 'already registered';
  end if;
  return new;
end;
$$;

drop trigger if exists licenses_block_duplicate_tz on public.licenses;
create trigger licenses_block_duplicate_tz
  before insert on public.licenses
  for each row
  execute function public.block_duplicate_teudat_zehut();
