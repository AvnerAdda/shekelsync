# Troubleshooting

## The app is blocked on first launch

For an unsigned macOS build, use **System Settings → Privacy & Security → Open Anyway**. Download from the official [Releases page](https://github.com/AvnerAdda/shekelsync/releases). Unsigned macOS builds require manual updates.

On Windows, verify the installer came from this repository before continuing through an unknown-publisher SmartScreen prompt. On Linux, check that the AppImage has executable permission.

## Credentials are not saved, or a keychain error appears

ShekelSync needs a functioning OS keychain to protect saved credentials. Check Keychain on macOS, Credential Manager on Windows, or Secret Service/libsecret on Linux. Headless Linux and WSL sessions may lack an available keychain service.

The repository's development setup documents a local encryption-key fallback for headless development. Follow the [README](https://github.com/AvnerAdda/shekelsync/blob/main/README.md#development) when running from source.

## An institution fails to sync

1. Check whether the institution needs another authentication step.
2. Confirm the time and result of the last successful sync.
3. Retry later if the provider is unavailable or has changed its website.
4. Check existing [issues](https://github.com/AvnerAdda/shekelsync/issues) before opening a new report.

Institution support depends on the [israeli-bank-scrapers](https://github.com/eshaham/israeli-bank-scrapers) ecosystem. Include the provider, app version, operating system, and error message in a bug report. Omit passwords, one-time codes, account numbers, and unredacted financial records.

## Totals or forecasts look wrong

Check the date range, last successful sync, transaction categories, and bank/card payment matching. A forecast or available-to-spend estimate also needs recent balances and sufficient transaction history. Check any labels explaining incomplete data, fallback estimates, or manual overrides.

Compare imported records with your institution's statements before changing planning assumptions.

## Something changed after an update

Open **Settings → Data** to restore a database backup if needed. Backups are stored beside the database in your OS user-data directory. Keep a copy of the current database before investigating a data problem.

## Reporting a bug

Use [GitHub Issues](https://github.com/AvnerAdda/shekelsync/issues) for reproducible problems. Include the version, platform, steps, expected behavior, and actual result. Diagnostics can be exported through Settings; developers can also run `npm run logs:bundle` from the source repository. Review attachments before sharing them.

For usage questions, use [Q&A](https://github.com/AvnerAdda/shekelsync/discussions/categories/q-a). For vulnerabilities, follow [SECURITY.md](https://github.com/AvnerAdda/shekelsync/blob/main/SECURITY.md).
