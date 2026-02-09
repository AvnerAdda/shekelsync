# Supabase License Table Migration (Email-Based Licensing)

This project has moved license registration from Israeli ID (Teudat Zehut) to email.
Apply the following changes to your Supabase `licenses` table.

## Recommended SQL (Postgres)

```sql
-- 1) Add email column (if missing)
alter table public.licenses
  add column if not exists email text;

-- 2) Backfill email from legacy column
update public.licenses
set email = coalesce(email, teudat_zehut)
where email is null;

-- 3) Relax legacy column (optional but recommended)
-- If teudat_zehut is varchar(9), this prevents email insert errors.
alter table public.licenses
  alter column teudat_zehut drop not null;

alter table public.licenses
  alter column teudat_zehut type text;

-- 4) Optional: drop legacy column once you're satisfied
-- alter table public.licenses drop column if exists teudat_zehut;

-- 5) Optional: enforce uniqueness on email (if required)
-- create unique index if not exists licenses_email_key on public.licenses (email);
```

## Notes
- The app now writes to `email` when the column exists and only falls back to `teudat_zehut` if the column is missing.
- Once the migration is applied, you can remove any constraints or policies that assume a 9‑digit ID.
- If you maintain RLS policies that check `teudat_zehut`, update them to use `email`.
