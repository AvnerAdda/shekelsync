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

## Commit Quality

- Use clear commit messages describing intent.
- Prefer explicit naming and straightforward control flow.
- Keep backward compatibility in mind for APIs and saved data.

## Security Notes

- Never commit `.env` values with real credentials.
- `SHEKELSYNC_ENCRYPTION_KEY` must be managed securely in production.
- Use private reporting for vulnerabilities (see `SECURITY.md`).
