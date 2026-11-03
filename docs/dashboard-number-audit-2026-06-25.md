# Dashboard Number Audit - 2026-06-25

The follow-up found that dashboard summary totals matched the sum of daily history
totals in both audited windows. The mismatch in
[the earlier audit](dashboard-number-audit-2026-03-26.md) was no longer reproducible.
Personal balances, account labels, row counts, and transaction totals have been removed.

## Verification method

Use a private, read-only SQLite copy and mirror the dashboard service predicates:

- Join `category_definitions` to classify income, expenses, capital returns, and investments.
- Exclude `transaction_pairing_exclusions` and `is_pikadon_related` rows.
- Count pending expenses using `processed_date` after a fixed audit cutoff.
- Compare each summary total with its daily-history aggregate using identical date windows.
- Check paired credit-card repayments separately to confirm they are not double-counted.

The source logic is in `app/server/services/analytics/dashboard.js`; summary-card
math is in `renderer/src/features/dashboard/components/summary-cards-helpers.ts`.
Use a project-supported Node runtime compatible with the installed SQLite module.

## Synthetic reconciliation example

All values in this section are fictional and illustrate the formula only.

| Metric | Summary | Sum of daily history |
| --- | ---: | ---: |
| Income | 12,000 | 12,000 |
| Expenses | 7,000 | 7,000 |
| Capital returns | 0 | 0 |
| Net investments | 1,000 | 1,000 |

Current-month savings:

`12,000 - 7,000 - max(0, 1,000 - 0) = 4,000`

With fictional pending expenses of 5,000 and a bank snapshot of 20,000:

- Savings after pending expenses: `4,000 - 5,000 = -1,000`.
- Projected bank balance: `20,000 - 5,000 = 15,000`.

A deficit relative to current-month savings can coexist with a positive bank balance.
Pending expenses remain separate from the current-month savings card.
