-- Enable RLS on supporter-program tables exposed through PostgREST.
-- These tables are intended for server-side access via the Supabase service role.

alter table if exists public.supporter_intents
  enable row level security;

alter table if exists public.supporter_entitlements
  enable row level security;
