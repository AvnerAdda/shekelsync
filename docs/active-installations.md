# Active installation counts

ShekelSync can count opted-in installations active today (UTC), in the last seven days, and in the last 30 days. Reopening or updating the app does not create another installation. Two computers/profiles count separately. Reinstalling without the existing user-data directory or opting out and back in creates a new ID and can increase the count within a reporting window. These are installation counts, not verified people or all users.

This is separate from Aptabase's anonymous event analytics. Existing Aptabase consent does not enable persistent counting. Aptabase intentionally cannot deduplicate monthly active users; see its [privacy model and limitations](https://aptabase.com/).

## User controls

In **Settings → Privacy & Security → Usage statistics**:

- **Include this installation in active-usage counts** grants separate consent, initially off. The random ID and random revocation token are created only after consent, when the packaged app is used in the foreground.
- **Exclude this installation from all usage statistics** is intended for the maintainer's own installed/testing copy. It suppresses Aptabase events, turns off installation counting, and requests removal of its counting history.
- Turning counting off queues deletion before retiring the local ID. Offline deletion is retried on the next launch. Re-enabling counting waits for pending deletion and then creates a fresh ID.

Development builds never contribute to installation counts, including when Aptabase debugging is enabled. `SHEKELSYNC_ANALYTICS_EXCLUDE=true` also excludes a packaged testing copy, independently of saved preferences.

The main process records foreground focus/navigation and checks a focused, visible window every five minutes for a new UTC day. The computer must have had input within the preceding five minutes. Minimized, hidden, unfocused, idle, and background-sync activity does not contribute. The server deduplicates installation/day pairs and uses server dates, so retries cannot multiply counts or invent historical activity.

## Local and hosted storage

The ID and revocation token live in `usage/installation-activity.json` in the OS user-data directory, outside the financial database and its backups. They are not exposed to the renderer, attached to Aptabase events, or included in diagnostics bundles. File permissions are restricted where supported.

The collector stores only a random ID, a SHA-256 hash of the revocation token, a revocation flag, and UTC activity dates. A forgotten ID retains a revocation marker to reject delayed requests; its activity is removed. The daily retention job deletes activity and identities inactive for 90 days. Raw request IPs are not added to the counting tables; the hosting provider still processes network requests and may maintain service logs.

The private `shekelsync_usage` schema has RLS enabled and grants no client access. Public RPCs permit only reporting/forgetting an ID with its token. Aggregates are available only to the service role/project administrator. The packaged app must never contain an administrator or service-role key.

## Deployment

1. Select an active Supabase project. Both accessible projects were paused when this feature was prepared; installing the app does not resume a project.
2. Apply [`2026-11-19_installation_activity.sql`](../scripts/migrations/2026-11-19_installation_activity.sql) to that hosted project, never to a user's local financial database.
3. Apply [`installation-activity-retention.sql`](../scripts/supabase/installation-activity-retention.sql). Verify the `shekelsync-installation-activity-retention` Cron job exists before accepting reports.
4. Configure `electron/installation-activity-config.json` with the project's HTTPS URL and a **publishable/anon** key before packaging a release. It defaults to an unavailable collector until hosting is configured. Override both values together with `SHEKELSYNC_USAGE_METRICS_URL` and `SHEKELSYNC_USAGE_METRICS_KEY` for a separate deployment. Service-role/secret keys are rejected.
5. Verify anonymous clients can report/forget but cannot read counts or raw tables, then publish the updated app. Counting begins as users install it and explicitly opt in; past downloads and sessions cannot be reconstructed.

The public write endpoint cannot prove that a request came from an authentic installation. IDs and tokens prevent collisions/unauthorized removal, but deliberately invented installations can inflate analytics. Use these as voluntary product-usage estimates, not billing or identity records.

## Read counts

As the project owner, run in Supabase's SQL editor:

```sql
select * from public.get_installation_activity_counts();
```

Or use your signed-in Supabase CLI account locally:

```bash
npm run usage:stats -- --project-ref YOUR_PROJECT_REFERENCE
npm run usage:stats -- --project-ref YOUR_PROJECT_REFERENCE --json
```

The command reads `SUPABASE_ACCESS_TOKEN` or the local CLI token file. It requests only aggregates, prints no credentials or installation IDs, and makes no database changes.

## Verification

Electron tests cover consent, restarts, app updates, concurrent reports, exclusion, offline retries, revocation, and credential handling. Renderer tests cover consent/exclusion controls. The collector workflow applies the migration and runs SQL tests against disposable PostgreSQL 17, including role permissions, rolling-window boundaries, deduplication, revocation, and retention.
