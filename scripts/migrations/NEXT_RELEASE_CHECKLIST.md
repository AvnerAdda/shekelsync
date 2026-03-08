# Next Release Migration Checklist

Use this checklist on every release bump (for example from `0.1.14` to `0.1.15`).

## 1) Run migration review

```bash
npm run release:migrations:check
```

If migration deltas are expected and already reviewed, acknowledge with:

```bash
npm run release:migrations:check:allow
```

## 2) Decide rollout per migration

- [ ] Does this migration need to run for already-installed users?
- [ ] Is it safe and idempotent?
- [ ] Should it run automatically at app startup, or manually via script?
- [ ] Is there a backup/rollback plan?

## 3) Release wiring

- [ ] Add/verify `migrate:*` script entries in root `package.json`.
- [ ] Document migration commands in PR/release notes.
- [ ] For new DB installs, ensure `scripts/init_sqlite_db.js` reflects final schema.

## 4) Cleanup hygiene

- [ ] Archive/remove obsolete migration files when no longer needed.
- [ ] Keep `scripts/migrations/` focused on active/recent migrations.

