# Dashboard Number Audit - 2026-03-26

This historical audit found a mismatch between a displayed dashboard and its source
ledger. A later audit could no longer reproduce it; see
[the June follow-up](dashboard-number-audit-2026-06-25.md).
Personal financial values and account labels have been removed. The example below
is entirely synthetic and does not reproduce the audited household's finances.

## Dashboard formula

The current-month card computes:

`income - expenses - max(0, netInvestments - capitalReturns)`

For fictional income of 12,000, expenses of 4,000, investment outflow of 1,000,
and capital returns of 2,000:

`12,000 - 4,000 - max(0, 1,000 - 2,000) = 8,000`

Capital returns exceeding investment outflow reduce the investment drag to zero.
Pending expenses are displayed separately.

## Findings retained from the audit

- The screenshot's card formula was internally consistent.
- Income, capital returns, investments, and bank balance reconciled with the source.
- Expenses and pending rows did not match the source ledger at the time of inspection.
- Paired credit-card repayments were excluded correctly and did not explain the mismatch.

## Verification method

Recompute totals using the predicates in
`app/server/services/analytics/dashboard.js` and the card formula in
`renderer/src/features/dashboard/components/summary-cards-helpers.ts`:

- Join `category_definitions` for income, expense, capital-return, and investment types.
- Count positive income rows with `is_counted_as_income = 1` as income.
- Count positive income rows with `is_counted_as_income = 0` as capital returns.
- Exclude `transaction_pairing_exclusions` and `is_pikadon_related` rows.
- Compute bank balance from the latest active `bank_balance` account snapshots.
- Count pending expenses with a non-null `processed_date` after the audit cutoff.
- Use the same calendar boundaries in the renderer and backend.

Run investigations against a private, read-only ledger copy. Public notes should
contain synthetic examples and technical conclusions, without source balances,
account numbers, transaction details, or screenshots of personal finances.
