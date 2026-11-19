#!/usr/bin/env node
// Owner-only report. Management credentials are read locally and never shipped.
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const config = require('../electron/installation-activity-config.json');

async function main() {
  const args = process.argv.slice(2);
  const projectIndex = args.indexOf('--project-ref');
  let projectRef = projectIndex >= 0 ? args[projectIndex + 1] : process.env.SHEKELSYNC_USAGE_PROJECT_REF;
  if (!projectRef && config.supabaseUrl) projectRef = new URL(config.supabaseUrl).hostname.split('.')[0];
  if (!/^[a-z]{20}$/.test(projectRef || '')) throw new Error('Pass --project-ref <Supabase project reference> or configure the activity collector.');
  const token = process.env.SUPABASE_ACCESS_TOKEN
    || (await fs.readFile(path.join(os.homedir(), '.supabase', 'access-token'), 'utf8').catch(() => '')).trim();
  if (!token) throw new Error('Sign in with the Supabase CLI or set SUPABASE_ACCESS_TOKEN locally.');
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'select * from public.get_installation_activity_counts();' }),
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Could not read activity counts (HTTP ${response.status}). Check project status and collector deployment.`);
  const rows = await response.json();
  const counts = rows?.[0];
  if (!counts || !['daily_active', 'weekly_active', 'monthly_active'].every((key) => Number.isFinite(Number(counts[key])))) {
    throw new Error('The collector did not return valid activity counts.');
  }
  if (args.includes('--json')) console.log(JSON.stringify(counts, null, 2));
  else {
    console.log(`Opted-in active installations as of ${counts.as_of} (UTC)`);
    console.log(`Today: ${counts.daily_active}\nLast 7 days: ${counts.weekly_active}\nLast 30 days: ${counts.monthly_active}`);
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
