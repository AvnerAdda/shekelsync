# Supabase Supporter Program Schema

This document defines the minimum Supabase schema required for the Buy Me a Coffee
supporter flow in the desktop app.

## Tables

### 1) `supporter_intents`
Records plan selections when users click a plan in the app.

```sql
create table if not exists public.supporter_intents (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  email text,
  plan_key text not null check (plan_key in ('one_time', 'bronze', 'silver', 'gold', 'lifetime')),
  status text not null default 'pending' check (status in ('clicked', 'pending', 'verified', 'rejected')),
  provider text not null default 'buy_me_a_coffee',
  source text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists supporter_intents_user_id_idx on public.supporter_intents (user_id);
create index if not exists supporter_intents_email_idx on public.supporter_intents (email);
create index if not exists supporter_intents_status_idx on public.supporter_intents (status);
create index if not exists supporter_intents_created_at_idx on public.supporter_intents (created_at desc);
```

### 2) `supporter_entitlements`
Stores validated supporter access that the app applies.

```sql
create table if not exists public.supporter_entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  email text,
  tier text not null default 'none' check (tier in ('none', 'one_time', 'bronze', 'silver', 'gold', 'lifetime')),
  plan_key text check (plan_key in ('one_time', 'bronze', 'silver', 'gold', 'lifetime')),
  status text not null default 'pending' check (status in ('none', 'pending', 'verified', 'rejected')),
  billing_cycle text check (billing_cycle in ('monthly', 'one_time', 'lifetime')),
  amount_usd numeric,
  provider text not null default 'buy_me_a_coffee',
  provider_reference text,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id)
);

create index if not exists supporter_entitlements_email_idx on public.supporter_entitlements (email);
create index if not exists supporter_entitlements_status_idx on public.supporter_entitlements (status);
create index if not exists supporter_entitlements_updated_at_idx on public.supporter_entitlements (updated_at desc);
```

## Validation flow

1. App inserts a row in `supporter_intents` with `status='pending'` when a user picks a plan.
2. You validate payment (manually or via webhook integration).
3. Upsert `supporter_entitlements` for the user with:
   - `status='verified'`
   - correct `tier` / `plan_key`
   - optional `amount_usd`, `billing_cycle`, `provider_reference`, `verified_at=now()`
4. App refreshes `/api/donations/status` and applies supporter access.

## Troubleshooting

- Error: `Could not find the table 'public.supporter_intents' in the schema cache`
  - Run the SQL in this document in the Supabase SQL Editor.
  - Confirm table names match env values (`SUPABASE_SUPPORTER_INTENTS_TABLE`, `SUPABASE_SUPPORTER_ENTITLEMENTS_TABLE`).
  - Wait a few seconds and retry (PostgREST schema cache can lag briefly after table creation).

## Environment variables required

Set these in `app/.env.local` (or runtime env):

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- optional table overrides:
  - `SUPABASE_SUPPORTER_ENTITLEMENTS_TABLE`
  - `SUPABASE_SUPPORTER_INTENTS_TABLE`
- optional auth strictness:
  - `SUPPORTER_REQUIRE_AUTH=true` (default is `false`, which allows anonymous local identity fallback)
