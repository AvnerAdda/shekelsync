# Dashboard Number Audit - 2026-03-26

## Summary

- Source of truth: `/home/addavner/shekelsync/dist/shekelsync.sqlite`
- Assumed UI context: the currently running dev Electron app, showing the March 2026 current-month window
- Dashboard summary logic source: `app/server/services/analytics/dashboard.js`
- Current Month card formula source: `renderer/src/features/dashboard/components/summary-cards-helpers.ts`

The screenshot is internally consistent, but it only partially matches the live SQLite data.

## Why `Current Month` = `₪14,730` in the Screenshot

The finance card uses:

`totalIncome - totalExpenses - max(0, netInvestments - totalCapitalReturns)`

Using the screenshot values:

`25,758 - 11,028 - max(0, 2,000 - 11,117) = 14,730`

Because `Capital Returns` is larger than `Investments`, the effective investment drag becomes `0`, so the card reduces to:

`25,758 - 11,028 = 14,730`

## Live DB Values Confirmed

Recomputed directly from `transactions`, with:

- `transaction_pairing_exclusions` applied
- `is_pikadon_related` excluded
- category rules aligned with `app/server/services/analytics/dashboard.js`

Confirmed values:

- Income: `25,757.85`
- Capital Returns: `11,117.07`
- Investment outflow: `2,000.00`
- Investment inflow: `0.00`
- Current bank balance: `25,476.03`

Bank balance snapshot:

- Account: `Discount - Balance`
- Snapshot date: `2026-03-10`
- Snapshot value: `25,476.03`

## Screenshot Values That Do Not Reconcile to the Current DB

The screenshot lines below do not match the live SQLite state:

- Expenses: screenshot `11,028`
- Pending: screenshot `2,795` across `35` rows

Current-month live DB comparison:

- Expenses: `9,779.52` for the straightforward March calendar-month query
- Expenses: `9,789.52` when using the alternate month-boundary variant seen in the renderer/backend date handling
- Pending: `5,721.62` across `52` rows

Implication:

- The screenshot math is self-consistent
- The screenshot values do not fully reflect the current contents of `dist/shekelsync.sqlite`

## Validation Checks Performed

### 1. Dashboard summary recomputation

Recomputed from `transactions` using the same category logic as the dashboard service:

- counted income: positive income rows where `is_counted_as_income = 1`
- capital returns: positive income rows where `is_counted_as_income = 0`
- expenses: negative expense rows
- investments: negative investment rows as outflow, positive investment rows as inflow

### 2. Bank balance recomputation

Recomputed from the latest active `bank_balance` account snapshots in:

- `investment_accounts`
- `investment_holdings`

Result:

- `25,476.03`

### 3. Pending recomputation

Recomputed with:

- same March current-month window
- `processed_date IS NOT NULL`
- `DATE(processed_date) > DATE('now')`
- pairing exclusions removed
- pikadon rows excluded

Result:

- `52` rows
- `5,721.62`

### 4. Credit-card repayment exclusion cross-check

Checked whether excluded repayment rows were being double-counted.

Result:

- Total repayment rows in March: `9`
- Total repayment amount: `10,780.65`
- Not excluded: `0.00`
- Excluded: `10,780.65`

Conclusion:

- credit-card repayment exclusions are working as expected
- they do not explain the mismatch between the screenshot and the current DB

## Environment Notes

- The repo script `npm run dev:electron:real` sets:
  - `SQLITE_DB_PATH=$(pwd)/dist/shekelsync.sqlite`
  - `USE_SQLITE=true`
- The running dev app process observed during the audit matched that setup

## Final Conclusion

The screenshot can be explained from its own displayed values, and the `Current Month` number is mathematically correct under the current UI formula.

However, the live database currently supports only part of the screenshot:

- confirmed: Income, Capital Returns, Investments, Bank
- not confirmed: Expenses, Pending

So the screenshot is internally coherent, but it is not a full match for the current SQLite state.
