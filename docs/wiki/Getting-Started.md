# Getting started

## Download and install

Use the official [GitHub Releases page](https://github.com/AvnerAdda/shekelsync/releases/latest). Choose the installer for your operating system.

| Platform | Download | Install |
| --- | --- | --- |
| macOS | Universal `.dmg` for Intel and Apple Silicon | Open the disk image and drag ShekelSync into Applications. |
| Windows | `.exe` installer | Run the installer and follow its prompts. |
| Linux | `.AppImage` | Make it executable with `chmod +x ShekelSync*.AppImage`, then run it. |

For an unsigned macOS build, open **System Settings → Privacy & Security → Open Anyway** if the first launch is blocked. Unsigned macOS builds update manually: download and install the next release.

Windows SmartScreen may show an unknown-publisher prompt for an unsigned installer. Check that your installer came from this repository before continuing through **More info → Run anyway**.

On Linux, a working Secret Service/libsecret keychain is needed to protect saved credentials. See [Troubleshooting](Troubleshooting) for keychain problems.

## Connect your first institution

1. Launch ShekelSync and add a financial institution.
2. Select your bank or card provider from the institutions offered by the app.
3. Enter your credentials and complete any authentication requested by that institution.
4. Run a sync and check its result before reviewing balances and transactions.
5. In **Activity**, review imported transactions and their categories. Check bank/card payment matching so repayments are not counted as additional spending.

Syncs connect directly from your computer to the institution. Provider websites and authentication flows can change, so support can vary between releases.

## Make the first overview useful

- Start with **Home** to check income, expenses, investments, and projected balances.
- Use **Review all** to inspect items needing attention.
- Open **Plan** for spending categories, available-to-spend estimates, goals, scenarios, and budgets.
- Use **Wealth** for investments, debts, properties, and mortgages.
- Check **Settings → Data** for database backup and restore controls.

See [Features](Features) for the differences between tracking, forecasts, and saved plans.
