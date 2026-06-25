# Dashboard Number Audit - 2026-06-25

## Summary

- Source of truth: `/home/addavner/shekelsync/dist/shekelsync.sqlite`
- Audit date: 2026-06-25
- Dashboard logic source: `app/server/services/analytics/dashboard.js`
- Summary card formula source: `renderer/src/features/dashboard/components/summary-cards-helpers.ts`

The current database reconciles under the dashboard predicates. For the audited March 2026 and June 2026 windows, dashboard summary totals match the sum of daily dashboard history totals exactly.

## Verification Method

The audit used SQLite directly because the shell's default Node runtime is `v20.20.0`, while the installed `better-sqlite3` native module was built for a newer Node ABI. The SQL query mirrored the dashboard service predicates:

- `category_definitions` joins for income, expense, capital return, and investment classification
- `transaction_pairing_exclusions` rows excluded from normal summary/history totals
- `is_pikadon_related` rows excluded from normal dashboard totals
- pending expenses counted from expense rows where `processed_date` is after `DATE('now')`

## Reconciliation Results

| Window | Income | History Income | Expenses | History Expenses | Capital Returns | History Capital Returns | Net Investments | Pending Expenses | Pending Count |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| March 2026 | 43,074.43 | 43,074.43 | 10,601.76 | 10,601.76 | 11,000.00 | 11,000.00 | 2,000.00 | 0.00 | 0 |
| June 2026 | 24,651.54 | 24,651.54 | 17,020.32 | 17,020.32 | 0.00 | 0.00 | 5,791.00 | 10,252.72 | 49 |

All summary-to-history deltas are `0.00`.

## Current Summary Card Math

The current-month card computes:

`income - expenses - max(0, netInvestments - capitalReturns)`

For June 2026:

`24,651.54 - 17,020.32 - max(0, 5,791.00 - 0.00) = 1,840.22`

Pending expenses are displayed separately. If included as a future cash-flow impact:

`1,840.22 - 10,252.72 = -8,412.50`

The latest bank-balance snapshot is:

- Account: `Discount - Balance`
- Snapshot date: `2026-06-24`
- Snapshot value: `81,661.18`

Projected bank balance after pending expenses:

`81,661.18 - 10,252.72 = 71,408.46`

So pending expenses currently create a cash-flow deficit relative to June net savings, but they do not overdraw the current bank balance.

## Pairing Exclusions

Rows excluded through `transaction_pairing_exclusions`:

| Window | Excluded Rows | Absolute Total |
| --- | ---: | ---: |
| March 2026 | 11 | 10,870.17 |
| June 2026 | 9 | 20,446.53 |

These exclusions are expected to keep paired credit-card repayments from double-counting.

## Conclusion

The older 2026-03-26 mismatch is no longer reproducible against the current SQLite database. The current dashboard aggregation predicates reconcile internally for both the previously audited March window and the current June window.

Remaining operational note: local commands should run under the project Node version from `.nvmrc` (`22.12.0`) or with rebuilt native dependencies for the active Node runtime.
