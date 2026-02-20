# Supabase Supporter Program Schema

This document defines the minimum Supabase schema required for the desktop app donation flow.

## Tables

### 1) `supporter_intents`
Tracks when a user opens the donation flow and audit events from provider sync.

```sql
create table if not exists public.supporter_intents (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  email text,
  -- kept for backward compatibility; app writes one_time
  plan_key text default 'one_time' check (plan_key in ('one_time', 'bronze', 'silver', 'gold', 'lifetime')),
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
Stores payment-based supporter access the app applies.

```sql
create table if not exists public.supporter_entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  email text,
  -- app uses one_time for any donation > 0
  tier text not null default 'none' check (tier in ('none', 'one_time', 'bronze', 'silver', 'gold', 'lifetime')),
  -- kept for backward compatibility; app writes one_time
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

1. App inserts `supporter_intents` with `status='clicked'` when user opens the donation modal.
2. Payment is validated (manual sync, Stripe webhook, or server-side bridge).
3. Upsert `supporter_entitlements` with:
   - `status='verified'`
   - `tier='one_time'`
   - `amount_usd` (recommended)
   - optional `billing_cycle`, `provider_reference`, `verified_at=now()`
4. App refreshes `/api/donations/status` and grants AI access.
5. Once donation is recorded, monthly reminder stays off.

## Automatic entitlement sync API

The app exposes a secure sync endpoint:

- `POST /api/donations/entitlement`
- Required header: `X-Supporter-Sync-Secret: <SUPPORTER_SYNC_SECRET>`
- Body:

```json
{
  "userId": "user-uuid-or-stable-id",
  "email": "member@example.com",
  "status": "verified",
  "amountUsd": 5,
  "billingCycle": "one_time",
  "providerReference": "txn_123"
}
```

Rules:
- `status`: `pending | verified | rejected` (aliases like `active` are normalized)
- include `userId` and/or `email` so payment can be mapped to the app user identity
- any verified amount unlocks supporter access

## Stripe webhook pipeline

For Stripe-based donations/memberships, the app supports:

- `POST /api/donations/stripe/webhook`
- Required headers:
  - `Stripe-Signature` (validated against `STRIPE_WEBHOOK_SECRET`)
  - JSON body as sent by Stripe (raw payload required for signature checks)

Supported Stripe events:
- `checkout.session.completed`
- `checkout.session.expired`
- `invoice.paid`
- `invoice.payment_succeeded`
- `invoice.payment_failed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `payment_intent.succeeded`
- `payment_intent.payment_failed`
- `charge.refunded`

Identity mapping requirements:
- Include `metadata.userId` (preferred) or `customer_email` / `metadata.email`
- Donation amount is inferred from Stripe amount fields (`amount_total`, `amount_paid`, etc.)

Important deployment note:
- Stripe cannot directly call a local desktop API unless you expose it (for example via a secure relay/tunnel).
- In production, use a server-side webhook receiver (or edge function) that calls `/api/donations/entitlement` or writes `supporter_entitlements` directly.

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
- `SUPPORTER_SYNC_SECRET` (required for `POST /api/donations/entitlement`)
- `STRIPE_WEBHOOK_SECRET` (required for `POST /api/donations/stripe/webhook`)
- optional table overrides:
  - `SUPABASE_SUPPORTER_ENTITLEMENTS_TABLE`
  - `SUPABASE_SUPPORTER_INTENTS_TABLE`
- optional auth strictness:
  - `SUPPORTER_REQUIRE_AUTH=true` (default is `false`, which allows anonymous local identity fallback)
