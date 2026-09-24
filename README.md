# ShekelSync

<p align="center">
  <img src="build-resources/logo.png" alt="ShekelSync logo" width="180" />
</p>

[![Latest Release](https://img.shields.io/github/v/release/AvnerAdda/shekelsync?display_name=tag)](https://github.com/AvnerAdda/shekelsync/releases)
[![CI](https://img.shields.io/github/actions/workflow/status/AvnerAdda/shekelsync/ci.yml?label=CI)](https://github.com/AvnerAdda/shekelsync/actions/workflows/ci.yml)
[![Security Audit](https://img.shields.io/github/actions/workflow/status/AvnerAdda/shekelsync/security-audit.yml?label=Security%20Audit)](https://github.com/AvnerAdda/shekelsync/actions/workflows/security-audit.yml)
[![Secret Scan](https://img.shields.io/github/actions/workflow/status/AvnerAdda/shekelsync/secret-scan.yml?label=Secret%20Scan)](https://github.com/AvnerAdda/shekelsync/actions/workflows/secret-scan.yml)
[![GitHub Stars](https://img.shields.io/github/stars/AvnerAdda/shekelsync?style=social)](https://github.com/AvnerAdda/shekelsync/stargazers)

Personal finance tracker for Israeli banks and credit cards, built as an Electron desktop app with a local API and a Vite-powered renderer.

Your data stays on your own machine: transactions are stored in a local SQLite
database and bank credentials are encrypted with a key held in your OS keychain.
See [`PRIVACY.md`](PRIVACY.md) for details on data handling.

## Installing (for users)

1. Download the latest build for your platform from the
   [Releases page](https://github.com/AvnerAdda/shekelsync/releases):
   - **macOS** — `.dmg` (universal: Intel + Apple Silicon)
   - **Windows** — `.exe` installer
   - **Linux** — `.AppImage`
2. Install and launch it:
   - **macOS** — open the `.dmg` and drag ShekelSync to Applications. If the
     build is unsigned, the first launch may be blocked: open **System Settings →
     Privacy & Security**, then click **Open Anyway** for ShekelSync. Unsigned
     builds update manually (download the next release) rather than in-app.
   - **Windows** — run the installer. If SmartScreen warns about an unknown
     publisher, choose **More info → Run anyway**.
   - **Linux** — mark the AppImage executable (`chmod +x ShekelSync*.AppImage`)
     and run it. A working Secret Service/libsecret keychain is recommended so
     credentials can be encrypted at rest.
3. On first run, add a financial institution and enter your credentials to import
   transactions. Credentials are encrypted locally and never leave your device
   except to connect directly to that institution.

See the [CHANGELOG](CHANGELOG.md) for what changed between releases.

## Planning your money

- **Plan → Spending Categories** shows time on the horizontal axis and cumulative
  category percentages on the vertical axis. Each day uses its own trailing
  30-, 60-, or 90-day income and expense window. Remaining income is allocated to
  Growth; spending above income extends beyond 100% and shows a deficit.
  Hover or select a date to inspect its window, and adjust category targets to
  move the horizontal reference lines. The timeline history control sets how
  far back the chart displays without changing the rolling-window length.
- **Plan → Available to spend** estimates what remains before your next income,
  after expected spending, outstanding card commitments, goal reserves, and a
  cash buffer. Recurring income dates and outstanding card payments are detected
  automatically from the shared forecast and imported billing data, and updated
  after each sync. Without a reliable payday, it uses a rolling 30-day period.
  Undated recent card purchases use a labeled conservative 45-day reserve.
  Optional overrides are available under **Adjust**; income overrides expire
  after that date and card overrides expire when source data changes.
  No manual setup is needed. If the detailed forecast is unavailable or incomplete,
  recent imported transactions provide a labelled spending estimate. It nets
  refunds within categories, excludes duplicate card repayments, and retains
  higher known forecast expenses. Recent shekel balances and imported transaction
  data are still needed; the app does not invent missing balances.
- **Plan → Goals & scenarios** lets you save goals with target dates, amounts
  already saved, and monthly contributions. Indicate whether existing savings
  are inside the included bank balance or held elsewhere. Allocations are local
  planning records and do not transfer money. Contributions are projected on the
  first of each upcoming month; update saved amounts as you make progress.
- In the same Plan tab, save **what-if scenarios** with one-time or monthly cash
  changes, and compare their projected balances with your current plan. These
  scenarios do not change transactions or the main forecast.
- **Wealth → Debt repayment planner** compares existing payments with extra
  payments directed to the highest-interest or smallest-balance debt. It shows
  payoff timing, interest, and monthly schedules separately for each currency.
  Estimates assume fixed rates, monthly interest, and no new borrowing or fees.

Goals, scenarios, and spending settings stay in the local database and are
included in database backups.

## Troubleshooting (for users)

- **macOS says the app is "damaged" or from an unidentified developer** — this is
  the unsigned-build gatekeeper prompt. Use **Privacy & Security → Open Anyway**
  (see above). Do not run `xattr` workarounds from untrusted sources.
- **The app won't start after an update, or data looks wrong** — ShekelSync makes
  a backup of your database before each update and before schema migrations, in a
  `backups` folder next to the database (in your OS user-data directory). You can
  restore a backup from **Settings → Data**.
- **Credentials aren't saved / keychain errors** — ShekelSync requires an OS
  keychain to encrypt credentials. On headless Linux/WSL this may be unavailable;
  see the development note below.
- **Scraping fails for a bank** — financial sites change without notice and can
  temporarily break scrapers. Retry later; if it persists, report it (below).
- **Collecting logs for a bug report** — run `npm run logs:bundle`, or use the
  in-app diagnostics/log export in **Settings**, and attach the output to your
  report. Logs are stored locally.

## Support

- **Bugs and feature requests:** open an issue at
  <https://github.com/AvnerAdda/shekelsync/issues>.
- **Security vulnerabilities:** do **not** open a public issue — follow the
  private reporting process in [`SECURITY.md`](SECURITY.md).
- **Privacy questions:** see [`PRIVACY.md`](PRIVACY.md).

## Repo Layout

- `electron/` Electron main process, preload, and security wiring.
- `app/` Local API server, database services, and shared libraries.
- `renderer/` React UI (Vite).
- `scripts/` Utilities for database setup, migrations, and tooling.
- `docs/` Internal documentation and migration notes.

## Requirements

- Node.js >= 22.12.0 (see `app/package.json`)

## Setup

```bash
npm install
npm --prefix app install
npm --prefix renderer install
```

## Development

```bash
# Start Electron + Vite renderer
npm run dev:electron

# Or run the embedded API only
npm run dev:api
```

On Linux, `npm run dev:electron` automatically falls back to `app/.env.local` for `SHEKELSYNC_ENCRYPTION_KEY` when no OS keychain service is available (for example in WSL/headless sessions).

Performance note: when the app window is minimized/hidden, renderer polling and ambient UI animation are paused and resume on focus to reduce idle CPU usage.

## Tests

```bash
npm test
```

## Build

```bash
npm --prefix app run dist
```

## Releases

- Cross-platform packaging is manual via workflow dispatch (`.github/workflows/package.yml`).
- The package workflow builds distributables for Linux, macOS, and Windows.
- Tag releases use Developer ID signing and notarization when the complete macOS credential set is configured.
- With no macOS signing credentials, tag releases publish explicit unsigned artifacts. macOS users must approve the app in Privacy & Security, and updates are manual because in-app macOS auto-update remains disabled.
- A partially configured macOS credential set fails closed instead of silently publishing an ambiguous build.
- Build artifacts are uploaded for each workflow run (unsigned when signing secrets are not provided).
- Before tagging a release, run migration review: `npm run release:migrations:check`.
- Published releases: https://github.com/AvnerAdda/shekelsync/releases

## Database

```bash
# Initialize local SQLite database
npm run init:sqlite
```

## Configuration

Local desktop runs use `app/.env.local`.
For production, set a strong `SHEKELSYNC_ENCRYPTION_KEY` and keep `ALLOW_DEV_NO_ENCRYPTION=false`.
For safety, existing SQLite files are not auto-reinitialized when schema validation fails (to avoid accidental data loss). To force reinitialization, set `SQLITE_AUTO_REINIT_ON_SCHEMA_MISMATCH=true`.

## Scraping and Compliance

This project uses `israeli-bank-scrapers` to connect to financial institutions. Before using scraping features, make sure you:

- Have authorization to access the target account.
- Comply with the institution terms of service and local law.
- Understand that site/API changes can break scrapers without notice.

You are responsible for lawful and compliant use in your jurisdiction.

## Security

- Report vulnerabilities privately; see `SECURITY.md`.
- Security audit workflow runs on push/PR/manual dispatch (`.github/workflows/security-audit.yml`).
- Secret scanning runs with gitleaks on push/PR/manual dispatch (`.github/workflows/secret-scan.yml`).
- CI gates tests and quality checks on push/PR (`.github/workflows/ci.yml`).
- Never commit credentials, private keys, or production `.env` files.
- Enable local secret scanning hooks: `npm run hooks:install`
- Run a manual full secret scan: `npm run secrets:scan`

## Community

- Contribution guide: `CONTRIBUTING.md`
- Code of conduct: `CODE_OF_CONDUCT.md`
- Privacy policy: `PRIVACY.md`
- Release history: `CHANGELOG.md`

## License

This project uses an open + commercial licensing model:

- Open-source license: `AGPL-3.0-or-later` (see `LICENSE`)
- Commercial license: available for proprietary/commercial usage without AGPL obligations (see `LICENSE-COMMERCIAL.md`)
- Trademarks/branding: see `TRADEMARKS.md`
