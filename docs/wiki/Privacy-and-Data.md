# Privacy and data

The [privacy policy](https://github.com/AvnerAdda/shekelsync/blob/main/PRIVACY.md) is the detailed reference for data handling. This page explains the practical basics.

## What stays on your device

ShekelSync stores transactions, balances, categories, investments, and planning records in a local SQLite database. It does not upload your financial database to a ShekelSync server.

Bank and credit-card credentials are encrypted at rest with AES-256-GCM. The encryption key is protected by the operating-system keychain. The SQLite financial database itself is **not encrypted at rest**, so protect your computer and backups appropriately.

Typical data directories are:

| Platform | User-data directory |
| --- | --- |
| macOS | `~/Library/Application Support/ShekelSync` |
| Windows | `%APPDATA%\ShekelSync` |
| Linux | `~/.config/ShekelSync` |

## What uses the network

Syncs connect directly to your selected financial institutions. Optional integrations can transmit data when you enable or configure them:

- **AI:** uses your own third-party provider key. Permitted financial context is anonymized before transmission; review the AI data permissions in Settings.
- **Telegram:** configured notifications are sent to Telegram using your bot and chat settings.
- **Donations:** payments are handled by the selected third-party processor.
- **Anonymous usage statistics:** off unless you opt in; controlled in **Settings → Privacy & Security**. They do not include financial records.

## Backups and exports

ShekelSync creates database backups before updates and schema migrations. Backups live in a `backups` folder alongside the database. Restore them from **Settings → Data**.

Database backups preserve local planning records, including goals, scenarios, and spending settings. CSV/JSON exports are useful for reviewing or moving records; they serve a different purpose from a database backup. Both can contain sensitive financial information.

## Sharing feedback safely

Remove names, account/card numbers, balances, and transaction details from screenshots and logs before posting publicly. Automated development screenshots use fictional demo data.

Report security vulnerabilities through the private process in [SECURITY.md](https://github.com/AvnerAdda/shekelsync/blob/main/SECURITY.md).
