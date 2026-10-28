# Changelog

All notable changes to ShekelSync are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project aims to follow [Semantic Versioning](https://semver.org/). While
the app is pre-1.0 (`0.x`), minor/patch numbers track incremental releases rather
than strict SemVer guarantees.

Release binaries are published at
<https://github.com/AvnerAdda/shekelsync/releases>.

## [Unreleased]

## [0.2.3] - 2026-10-28

### Security
- Run chatbot calculations in an isolated QuickJS (WebAssembly) interpreter instead
  of Node's `vm` module, with a 5-second timeout and 32 MB memory limit, and block
  chatbot queries against stored bank credentials.
- Anonymize chatbot query results before they are sent to the model: merchant names
  become generic labels, identifiers are redacted, and account/card/ID numbers are masked.
- Keep the master encryption key in memory only, so child processes (Chromium helpers,
  the scraper's browser) no longer inherit it through the environment.
- Mask account, card and ID numbers, balances, e-mail addresses and secrets in log
  files and diagnostics exports.
- Stop returning decrypted bank credentials from the credentials API.
- Pin CI workflow actions to commit SHAs and keep them current with Dependabot.

### Added
- Financial Health: choose month-to-date, 30-day or 60-day periods, see target lines
  and deviation markers on the allocation bar, and get a theme accent that reflects
  the overall score.
- Forecasts schedule the remaining payments of card installment plans
  ("payment N of M") and stop after the last one.

### Fixed
- Restoring a database now checks the file's integrity and that its saved credentials
  match this installation's key, backs up the current database first, and swaps the
  file in atomically.
- Card refunds are stored as credits; refunds that earlier versions recorded as
  charges are corrected on the next sync.
- Pending transactions the bank no longer reports (released holds, charges that
  completed with a different amount) are removed, and pending foreign-currency
  authorizations are no longer counted as shekels.
- Distinct same-day transactions to the same payee without a bank identifier are no
  longer merged, and a single sync no longer merges two of its own transactions.
- Forecasts no longer project recurring patterns that stopped (after 2.5 missed
  cycles) or bank debits that settle an imported card, which double-counted card
  purchases.
- Planning automation compares card billing dates by local calendar day.

### Changed
- Forecast model `pattern-v6`; replay evaluation in
  `docs/forecast-installments-evaluation-2026-10-26.md`.
- Update application dependencies.
- Keep the existing database schema; no migration is required for this release.

## [0.2.2] - 2026-10-21

### Added
- Edit transaction categories and delete individual transactions with a confirmation
  dialog from Activity, search, forecasts, and spending breakdowns.
- Merge duplicate real-estate accounts in the same currency while preserving
  linked transactions, valuation history, and property details.
- Add forecast replay tooling, adaptive expense estimates, recurring bill detection,
  and prediction intervals, with documented retrospective evaluations.

### Fixed
- Align forecast actuals and budget comparisons with calendar-month boundaries,
  account for income already received, and avoid repeating overdue income.
- Include refunds as signed amounts in spending breakdowns, include transactions
  on the final day of a period, and preserve distinct transactions across vendors.
- Match bank credentials to the correct investment accounts and improve balance
  rollforwards, historical valuations, and real-estate balance-sheet calculations.
- Keep planning automation and dashboard insights consistent with updated forecasts.

### Changed
- Simplify the cash-flow outlook and clarify estimated payment timing and forecast
  uncertainty, with updated English, French, and Hebrew translations.
- Update application dependencies and development tooling.
- Keep the existing database schema; no migration is required for this release.

## [0.2.1] - 2026-09-24

### Security
- Update development tooling dependencies to resolve reported Vitest, Joi,
  and js-yaml security advisories.

### Fixed
- Coordinate desktop startup and SQLite credential checks to prevent duplicate
  windows and connection races during launch.
- Recognize shekel currency symbols from card imports and distinguish foreign
  currency amounts, stale card syncs, and invalid amounts in planning messages.
- Daily-only forecasts no longer fail when simulations are disabled. Available
  to spend recognizes the current model's paydays and falls back to a labelled
  estimate from recent imported spending without requiring manual settings.

### Changed
- Improve recurring income and investment forecasts, forecast day details, and
  signed transaction chart breakdowns.
- Upgrade local databases automatically to schema version 10, preserving
  forecast history and adding planning tables. A pre-migration backup is taken;
  failures roll back and block startup. No manual migration is required.

### Added
- A spending-category time series with daily rolling income and expense windows,
  colored cumulative areas, saved target reference lines, surplus allocated to
  Growth, and deficits displayed when spending exceeds 100% of income.
- Savings goals with deadlines, progress, monthly contributions, and cash
  reserves in Plan. Saved what-if scenarios compare dated one-time or monthly
  changes against the current plan without changing financial history.
- An available-to-spend estimate in Plan with a next-income horizon,
  protected savings, cash buffer, automatic recurring income detection and card
  commitments from imported billing data. It refreshes after sync, uses a rolling
  30-day period for irregular income, and supports optional overrides alongside
  missing-data and freshness checks.
- Debt repayment comparisons and monthly schedules in Wealth, including extra
  payments, highest-interest-first and smallest-balance-first strategies, and
  separate calculations for each currency.
- Local persistence for goals, scenarios, and planning settings through an
  additive versioned database migration.

## [0.2.0] - 2026-09-01

### Added
- A first-class Activity ledger for recent transactions, with quick type filters,
  text search, visible-period totals, localized date groups, and direct access to
  the existing transaction detail and advanced search workflows.
- First-class Review, Plan, and Wealth routes. Existing Analysis, Budgets, and
  Investments deep links remain compatible and resolve to their v0.2 areas.
- Forecast prediction snapshots and calibration reporting so Money Review can
  distinguish learning, provisional, and measured forecast accuracy.

### Changed
- Reframed the desktop app as an action-first daily money cockpit with primary
  navigation for Home, Review, Activity, Plan, Wealth, and Settings.
- Redesigned the shell and Home hierarchy around opaque surfaces, clearer type,
  restrained elevation, a focused cash-flow summary, explicit period controls,
  and a visible local-device privacy cue.
- Improved Money Review freshness with evidence dates, recurring-alert identity,
  precise correction targets, and direct challenge accept/decline workflows.
- The release migration guard now reviews the versioned runtime migrations and
  fresh-install schema alongside standalone migration scripts.

### Fixed
- Prevented stale subscription and notification evidence from resurfacing as new
  review work, and made forecast evaluation reflect realized local data.
- Isolated analytics benchmarks in temporary databases, preventing benchmark
  setup from overwriting a developer database and supporting Electron-native
  SQLite builds without a local rebuild.
- Restored universal macOS packaging after the better-sqlite3 runtime upgrade.

## [0.1.35] - 2026-08-30

### Added
- Money Review: a local-first, prioritized action queue that unifies data-quality
  fixes, cash-flow and subscription alerts, optimizer recommendations, and
  financial challenges with durable start, snooze, complete, dismiss, and
  reopen workflows. Open work appears in a compact dashboard carousel and the
  full review runs in a focused modal instead of occupying primary navigation.
  Selecting a dashboard card opens a minimal item-only explanation with relevant
  comparisons, metrics, priority context, and local-data provenance.
- A shared financial-truth system connects user corrections across recurring
  patterns, subscriptions, forecasts, budgets, notifications, optimizer facts,
  generated quests, and chat context. Corrections are revisioned, preview their
  impact, support undo and restore, and never rewrite historical transactions.
- Deterministic Money Review and forecast states for first launch, missing API
  keys, insufficient history, pending calculations, and failed recalculations.

### Changed
- Startup now keeps the lightweight launch screen visible until the first usable
  Dashboard or error state is rendered. Money Review, Optimizer, and chatbot
  initialization is staggered into idle time to reduce first-paint contention.
- Dashboard charts now share a compact month-to-date, last-30-days, or custom
  date-range selector across transaction history and breakdown views, with
  localized English, French, and Hebrew labels.

## [0.1.34] - 2026-08-20

### Added
- A redesigned Optimizer v2 flow that confirms database summaries before users
  choose a scope and generate evidence-backed actions. Recurring categorized
  income now drives affordability analysis instead of reported profile income.
- Canonical investment position and event workflows, including allocation
  targets, liabilities, FX preferences and rates, benchmark comparisons, and
  expanded portfolio reconciliation.
- Versioned SQLite schema migrations tracked with `PRAGMA user_version`
  (`app/lib/schema-migrations.js`). Migrations run at startup inside their own
  transaction, take an automatic pre-migration database backup, and fail closed
  (rolling back and refusing to start) instead of serving a half-migrated
  database.
- `PRIVACY.md` describing the app's local-first data handling and the few
  opt-in features that transmit data off-device.
- `CHANGELOG.md` (this file).
- User-facing installation, troubleshooting, and support sections in `README.md`.

### Changed
- Improved dashboard summaries and transaction-history forecast visuals, with
  adaptive axes and translated labels.
- Expanded investment account management, analytics, performance breakdowns,
  and position editing and closing experiences.
- Set a `busy_timeout` pragma on SQLite connections to avoid transient
  "database is locked" errors under concurrent access.

### Fixed
- Optimizer review provenance is available on hover, and every “Fix at source”
  action now routes to its owning ShekelSync area.

### Security
- `shell.openExternal` now only opens `http`/`https`/`mailto` URLs; other
  protocols (e.g. `file:`, custom handlers) from a compromised renderer are
  blocked.
- The `api:request` proxy now validates that the endpoint stays on the embedded
  local API origin, preventing renderer-supplied endpoints from redirecting
  authenticated requests (with auth tokens and API keys attached) to an external
  host.
- The `ALLOW_DEV_NO_ENCRYPTION` (all-zero key) and `ALLOW_UNSAFE_IPC` (raw-SQL
  IPC) development escape hatches are now hard-disabled in packaged/production
  builds regardless of environment variables.

## [0.1.33] - 2026-08-09
### Fixed
- Linux development keychain fallback loop.

## [0.1.32] - 2026-08-09
### Fixed
- Legacy encryption-key migration on upgrade.

## [0.1.31] - 2026-08-09
### Added
- Improved operating cashflow forecasting.
- More proactive chatbot coaching.
### Changed
- Optimized the renderer and retired the legacy runtime.
- Hardened macOS production builds and credential handling.
- Allowed explicit unsigned macOS releases (with manual-update fallback).

## [0.1.30] - 2026-07-30
### Security
- Credential handling security fixes.

## [0.1.29] - 2026-07-27
### Added
- Universal (Intel + Apple Silicon) macOS build.

## [0.1.28] - 2026-07-26
### Fixed
- Preserve desktop data across app relaunch.

## [0.1.27] - 2026-07-21
### Added
- "Optimizator" financial action planner.
- Previous-month analytics and pending-expense breakdown.
- Donation-supported public access.
### Changed
- Upgraded dependencies and cleared all outstanding security advisories.

## [0.1.26] - 2026-06-22
### Changed
- Renderer performance safeguards and budgets.

## [0.1.25] - 2026-06-19
### Added
- Real-estate investment support.

## [0.1.24] - 2026-05-20
### Fixed
- DMG publishing guard for releases.

## [0.1.23] - 2026-05-18
### Added
- Illiquid real-estate investment category.
### Changed
- Improved analysis dashboard UX and investments tab UI.
### Security
- Hardened renderer secret handling.

## [0.1.22] - 2026-04-23
### Added
- Expanded portfolio analytics and dashboard insights.
### Changed
- Optimized macOS app responsiveness; removed Sentry.
### Security
- Overrode vulnerable `follow-redirects` version.

## [0.1.0] – [0.1.21] - 2026
Initial public release series. Highlights across these versions:

- Electron desktop app for Israeli bank and credit-card tracking, using
  `israeli-bank-scrapers`.
- Local SQLite storage with OS-keychain-backed credential encryption.
- Investments workflows (including IBKR sync and pikadon handling), AI financial
  profiling, chatbot, notifications, and Telegram digests.
- macOS code signing / notarization and GitHub-release auto-update wiring.
- Numerous scraping-reliability, double-counting, and schema-safety fixes,
  including guarding against unsafe SQLite schema reinitialization.

[Unreleased]: https://github.com/AvnerAdda/shekelsync/compare/v0.2.3...HEAD
[0.2.3]: https://github.com/AvnerAdda/shekelsync/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/AvnerAdda/shekelsync/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/AvnerAdda/shekelsync/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/AvnerAdda/shekelsync/compare/v0.1.35...v0.2.0
[0.1.35]: https://github.com/AvnerAdda/shekelsync/releases/tag/v0.1.35
[0.1.34]: https://github.com/AvnerAdda/shekelsync/releases/tag/v0.1.34
[0.1.33]: https://github.com/AvnerAdda/shekelsync/releases/tag/v0.1.33
[0.1.32]: https://github.com/AvnerAdda/shekelsync/releases/tag/v0.1.32
[0.1.31]: https://github.com/AvnerAdda/shekelsync/releases/tag/v0.1.31
[0.1.30]: https://github.com/AvnerAdda/shekelsync/releases/tag/v0.1.30
[0.1.29]: https://github.com/AvnerAdda/shekelsync/releases/tag/v0.1.29
[0.1.28]: https://github.com/AvnerAdda/shekelsync/releases/tag/v0.1.28
[0.1.27]: https://github.com/AvnerAdda/shekelsync/releases/tag/v0.1.27
[0.1.26]: https://github.com/AvnerAdda/shekelsync/releases/tag/v0.1.26
[0.1.25]: https://github.com/AvnerAdda/shekelsync/releases/tag/v0.1.25
[0.1.24]: https://github.com/AvnerAdda/shekelsync/releases/tag/v0.1.24
[0.1.23]: https://github.com/AvnerAdda/shekelsync/releases/tag/v0.1.23
[0.1.22]: https://github.com/AvnerAdda/shekelsync/releases/tag/v0.1.22
