# ShekelSync (Finance-Israel)

Personal finance tracker for Israeli banks and credit cards, built as an Electron desktop app with a local API and a Vite-powered renderer.

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

## Tests

```bash
npm test
```

## Build

```bash
npm --prefix app run dist
```

## Database

```bash
# Initialize local SQLite database
npm run init:sqlite
```

## Configuration

Copy `.env.example` and set values for your environment. For production, set a strong `CLARIFY_ENCRYPTION_KEY` and disable `ALLOW_DEV_NO_ENCRYPTION`.

## Scraping and Compliance

This project uses `israeli-bank-scrapers` to connect to financial institutions. Before using scraping features, make sure you:

- Have authorization to access the target account.
- Comply with the institution terms of service and local law.
- Understand that site/API changes can break scrapers without notice.

You are responsible for lawful and compliant use in your jurisdiction.

## Security

- Report vulnerabilities privately; see `SECURITY.md`.
- Never commit credentials, private keys, or production `.env` files.

## Community

- Contribution guide: `CONTRIBUTING.md`
- Code of conduct: `CODE_OF_CONDUCT.md`

## License

MIT (see `LICENSE`)
