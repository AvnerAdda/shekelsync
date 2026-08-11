# ShekelSync Privacy Policy

_Last updated: 2026-08-11_

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
  configure: the optional AI assistant, optional Telegram notifications, and
  optional donations. Each is described below.

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
  troubleshooting.

ShekelSync does not operate a backend that collects this data, and the app does
not include analytics, tracking, or telemetry that reports your usage back to
the developer.

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

## Data security

- Credentials are encrypted at rest using AES-256-GCM with an authenticated tag.
- The master encryption key is stored in your OS keychain and is required for the
  app to decrypt credentials. If the keychain is unavailable, the app fails
  closed rather than falling back to weaker protection.
- The embedded local API server binds to `localhost` only and requires an
  auth token; it is not reachable from your network.

No software is perfectly secure, and you remain responsible for the security of
your own device and OS user account.

## Your control over your data

- **Export:** you can export your data (CSV/JSON) from within the app.
- **Backups:** the app creates a local backup of your database before applying
  updates or schema migrations, stored in a `backups` folder next to the
  database.
- **Deletion:** deleting the app's user-data directory removes your local data.
  Removing stored credentials also removes them from the OS keychain.

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
