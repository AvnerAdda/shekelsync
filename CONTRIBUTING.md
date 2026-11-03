# Contributing

## Development Setup

Prerequisites:

- Node.js `>= 22.12.0`

Install dependencies:

```bash
npm install
npm --prefix app install
npm --prefix renderer install
```

Run locally:

```bash
npm run dev:electron
```

Run tests:

```bash
npm test
```

## Pull Request Guidelines

- Keep PRs focused and small when possible.
- Include tests for behavior changes.
- Update docs when interfaces or workflows change.
- Ensure lint/tests pass before requesting review.
- Do not include secrets, private keys, or production data.

## Test and Documentation Data

- Create fixtures from scratch with fictional names such as `Test User`,
  `Primary Card`, and `Example Employer Payroll`, and email addresses under `example.com`.
- Use clearly synthetic account numbers such as `0000001234` and distinct card
  endings such as `1111` and `2222`. Update matching and masking assertions together.
- Use simple invented financial amounts. Keep fractional values where they exercise
  rounding, currency parsing, or reconciliation, and calculate expected totals from
  those invented inputs.
- Do not copy personal transactions, employer names, addresses, salary figures,
  property details, or account balances into tests, screenshots, or developer reports.
  Renaming a person while retaining their financial history is insufficient.
- Keep local ledgers, database backups/sidecars, logs, and exported reports private.
  Use `scripts/seed_realistic_demo.js` for synthetic demo data. For public evaluation
  notes, retain the method and technical findings without household-specific details;
  clearly label fictional examples and never present them as measured results.

## Commit Quality

- Use clear commit messages describing intent.
- Prefer explicit naming and straightforward control flow.
- Keep backward compatibility in mind for APIs and saved data.

## Security Notes

- Never commit `.env` values with real credentials.
- `SHEKELSYNC_ENCRYPTION_KEY` must be managed securely in production.
- Use private reporting for vulnerabilities (see `SECURITY.md`).
