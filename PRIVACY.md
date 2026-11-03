# ShekelSync Privacy Policy

_Last updated: 2026-11-03_

ShekelSync is a **local-first desktop application**. Your financial data lives on
your own computer, under your own operating-system user account. This document
explains what data the app stores, where it stays, and the few cases where data
can leave your device — always under your control.

This policy describes the behavior of the open-source ShekelSync application in
this repository. If you build or modify the app yourself, you are responsible for
the behavior of your build.

## Summary

- Your transactions, account data, and credentials are stored **locally** in a
  SQLite database inside your OS user-data directory. They are **not** uploaded
  to ShekelSync servers — there are no ShekelSync servers that receive your
  financial data.
- Bank/credit-card credentials are **encrypted at rest** (AES-256-GCM) with a
  key held in your operating system keychain.
- Data leaves your device **only** for features you explicitly enable and
  configure: the optional AI assistant, optional Telegram notifications,
  optional donations, and optional anonymous usage statistics. Each is
  described below.

## What data ShekelSync stores, and where

All application data is stored locally in your OS user-data directory (for
example `~/Library/Application Support/ShekelSync` on macOS, `%APPDATA%\ShekelSync`
on Windows, `~/.config/ShekelSync` on Linux):

- **Financial data** — transactions, balances, categories, budgets,
  investments, and analytics — in a local SQLite database.
- **Bank/credit-card credentials** — used to scrape your accounts —
  encrypted with AES-256-GCM. The encryption key is stored in your OS keychain
  (Keychain on macOS, Credential Manager on Windows, Secret Service/libsecret on
  Linux), not in the database.
- **Application settings and logs** — including diagnostic logs kept locally for
  troubleshooting. Account, card and ID numbers, balances, e-mail addresses and
  secrets are masked before log lines are written.

ShekelSync does not operate a backend that collects this data. The only usage
reporting is the **opt-in**, anonymous usage statistics described below; it is
off unless you turn it on and never includes your financial data.

## When data leaves your device

Data is transmitted off your device only through features you turn on:

### 1. Connecting to your financial institutions

To import transactions, ShekelSync connects **directly** from your computer to
your bank or credit-card provider using the
[`israeli-bank-scrapers`](https://github.com/eshaham/israeli-bank-scrapers)
library. Your credentials are sent only to the corresponding institution, over
that direct connection. They are not routed through any intermediary service.

### 2. The optional AI assistant (bring your own key)

The AI chatbot, financial "optimizer," and profiling features are **off by
default**. If you enable them, you must supply **your own** third-party AI
provider API key. When you use these features:

- Requests are sent from your device to that AI provider (for example OpenAI)
  using your key. Your use is then also subject to **that provider's** privacy
  policy and terms.
- Before data is sent, ShekelSync applies **anonymization**: merchant names are
  replaced with stable generic labels (`Merchant_1`, `Merchant_2`, …), account
  numbers are masked, and identifying profile fields (such as age and income)
  are coarsened into bands.
- The assistant does **not** receive your bank credentials or passwords.
- Permissions controlling what data the assistant may use can be changed or
  revoked at any time in Settings.

If you never enable these features and never enter an AI provider key, no
financial data is sent to any AI provider.

### 3. Optional Telegram notifications

If you configure the optional Telegram integration with your own bot token and
chat ID, notification messages you enable are sent to Telegram's servers so they
can be delivered to you. This is off unless you configure it.

### 4. Optional donations

If you choose to donate to support the project, the payment is handled by a
third-party payment processor, subject to that processor's privacy policy.
ShekelSync does not receive or store your payment-card details.

### 5. Optional anonymous usage statistics (off by default)

The app asks once whether you want to share anonymous usage statistics, and
you can change your answer at any time in **Settings → Privacy & Security**.
Nothing is sent unless you opt in. When you do, the app sends small events to
[Aptabase](https://aptabase.com), a privacy-focused analytics service, so the
developer can see which features are used and notice when a bank connection
stops working.

Each event contains only:

- the event type: app started, a main screen opened (Home, Review, Activity,
  Plan, Wealth or Settings), an institution added, the first successful sync,
  a bank sync finished, a once-a-day feature summary, a startup or update
  failure, an app error, or statistics turned on;
- for an added institution or first sync: the institution code (for example
  `hapoalim`);
- for a finished sync: the institution code, whether it succeeded, the
  scraper's error type (for example `INVALID_PASSWORD` or `TIMEOUT`), whether
  it was started manually or by the scheduler, the version of the
  `israeli-bank-scrapers-core` library, and a rough duration bucket (for
  example "under 30 seconds");
- for the daily summary: whether auto-sync, Telegram notifications, the AI
  assistant (an API key is configured), a property, budgets and savings goals
  are set up; how many institutions are connected, as a range (0, 1, 2–3, 4+);
  and how long ago you started using the app, as a range (under a week, under a
  month, 1–3 months, more). The date itself is computed on your device and is
  not sent;
- for failures and errors: a fixed reason code (for example `network`,
  `keychain`, `database`) or the error's type name (for example `TypeError`),
  and which part of the app it came from (for example `main` or `plan`). Error
  messages and stack traces are not sent;
- app version, app language, operating system name and version, and whether
  the build is a development build;
- a random session identifier created when the app starts and kept in memory
  only. No persistent device, installation or user identifier is created.

The list of connected institutions is never sent as a whole, only the count
range, so combinations of banks can't single you out. Declining the prompt is
not reported.

Events **never** include amounts, transactions, merchants, categories,
balances, account, card or ID numbers, credentials, names, e-mail addresses,
error messages, or anything you type. The app enforces this with a fixed list
of allowed events and fields; any other value is dropped before sending.
Aptabase receives your IP address as part of the network request; according to
its documentation it does not store it and uses it only to derive an
approximate country. See Aptabase's privacy policy for details.

## Data security

- Credentials are encrypted at rest using AES-256-GCM with an authenticated tag.
- The master encryption key is stored in your OS keychain and is required for the
  app to decrypt credentials. On macOS and Windows, if the keychain is
  unavailable, the app fails closed rather than falling back to weaker
  protection. On Linux without a working Secret Service, you can instead supply
  the key through the `SHEKELSYNC_ENCRYPTION_KEY` environment variable; that key
  is only as safe as the place you store it.
- Your financial data (transactions, balances, account numbers) is **not**
  encrypted at rest; it relies on your OS user account and disk encryption
  (FileVault, BitLocker, LUKS).
- The embedded local API server binds to `localhost` only and requires an
  auth token; it is not reachable from your network.

No software is perfectly secure, and you remain responsible for the security of
your own device and OS user account.

## Your control over your data

- **Export:** you can export your data (CSV/JSON) from within the app.
- **Backups:** the app creates a local backup of your database before applying
  updates, schema migrations or a restore, stored in a `backups` folder next to
  the database. Backups and exports you save elsewhere are unencrypted copies of
  your financial data; store them accordingly.
- **Deletion:** deleting the app's user-data directory removes your local data.
  Removing an account deletes its encrypted credentials from the database (the
  OS keychain only holds the master key). Older encrypted copies can remain in
  the `backups` folder until you delete it.

## Children

ShekelSync is not directed to children and is intended for use by adults managing
their own finances.

## Changes to this policy

Material changes to this policy will be reflected in this file, with an updated
date at the top. Because releases are versioned, you can review the history of
this document in the project's version control.

## Contact

For privacy questions, security reports, or other concerns, see
[`SECURITY.md`](SECURITY.md) for private reporting channels, or open a
non-sensitive question as a GitHub issue.
