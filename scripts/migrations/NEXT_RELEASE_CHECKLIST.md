# Next Release Migration Checklist

Use this checklist on every release bump (for example from `0.1.14` to `0.1.15`).

## 0) Schema changes ship as versioned runtime migrations

Schema changes that must reach already-installed users belong in
`app/lib/schema-migrations.js`, not in ad-hoc startup fixes:

- Append an entry to `MIGRATIONS` with the next integer version.
- The migration must be idempotent (fresh installs already have the final
  schema but start at `user_version 0`, so it re-runs there).
- Never edit or delete a shipped migration.
- Mirror the final schema in `scripts/init_sqlite_db.js` for new installs.

The runner stamps `PRAGMA user_version`, wraps each migration in its own
transaction, and takes a file backup into `<db dir>/backups` before applying
anything. A failed migration rolls back and blocks startup instead of serving
a half-migrated database. Hand-run scripts in `scripts/migrations/` are for
one-off/developer maintenance only — end users never run them.

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
      If yes, it must be a versioned entry in `app/lib/schema-migrations.js`.
- [ ] Is it safe and idempotent?
- [ ] Is there a backup/rollback plan?

## 3) Release wiring

- [ ] Add/verify `migrate:*` script entries in root `package.json`.
- [ ] Document migration commands in PR/release notes.
- [ ] For new DB installs, ensure `scripts/init_sqlite_db.js` reflects final schema.

## 4) Cleanup hygiene

- [ ] Archive/remove obsolete migration files when no longer needed.
- [ ] Keep `scripts/migrations/` focused on active/recent migrations.

