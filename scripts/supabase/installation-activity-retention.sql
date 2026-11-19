-- Supabase deployment step, after the installation-activity migration.
-- Purge expired activity and revocation markers even when the app has no users.
create extension if not exists pg_cron;
do $$
begin
  if not exists (select 1 from cron.job where jobname = 'shekelsync-installation-activity-retention') then
    perform cron.schedule('shekelsync-installation-activity-retention', '17 3 * * *',
      'select shekelsync_usage.prune_activity()');
  end if;
end;
$$;
