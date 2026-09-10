# Pattern forecast version 2

The application runs one pattern model. The retired model, background comparison runs,
comparison API, and comparison UI have been removed. Prediction snapshots use `pattern-v2`
so accuracy observations from the previous implementation are not mixed with the new one.
Existing snapshot schemas and historical records are retained.

## Income and classification

Automatic recurring income learns timing separately from amount. It groups observations by
category, bank/vendor, and normalized source name, preserving Unicode and numeric source
identities. The payment amount is the median of the latest three observations. Cadence is
inferred from recent intervals, with monthly calendar anchors and separate handling for
weekly, biweekly, twice-monthly, quarterly, and annual receipts.

Three observations are required before replacing the existing projection for a category.
One unusual bonus does not become the recurring amount. Early receipts suppress the matching
future occurrence, month-end anchors respect February and leap years, and a detected stream
becomes inactive after 2.5 missed cycles. Explicit schedules bypass automatic inference.

Manual, confirmed, paused, ended, suppressed, overridden, or skipped patterns protect their
category from automatic replacement. This conservative scope avoids undoing a user's
correction when several sources share a category. New or unrecognized streams retain the
existing fallback.

Recurring receipts carry the same operating/non-operating classification as their category.
Automatic refunds, capital returns, and similar irregular receipts are not projected as
dependable income. Explicitly scheduled receipts remain available with their classification.
Investment transfers and positive expense refunds are not relabeled as automatic recurring
expenses or income. Custom income categories honor `is_counted_as_income` without requiring
English payroll keywords.

The daily forecast, displayed predictions, cumulative cash flow, and simulation inputs are
reconciled after replacement. An uncertain receipt is sampled at most once across candidate
dates. These changes do not establish that the simulation intervals have calibrated coverage.

## Selection and evaluation

Development compared calendar averages, medians, exponentially weighted estimates, payment
schedules, shorter expense windows, and adaptive expense estimators. Parameters were selected
on March–June transaction outcomes; July–August was excluded from parameter selection.
Because the later period was also inspected while diagnosing failed approaches, these are
exploratory retrospective results, not an untouched prospective trial.

The retained income defaults were a three-observation median and the learned payment date.
Expense parameter changes did not generalize consistently and were rejected. The existing
variable-expense estimator remains. Classification corrections still change some expense
predictions: expense accuracy is mixed, especially at longer horizons. The strongest measured
improvements are in operating income and operating cash flow. A single household's ledger and
finite scenario tests cannot establish performance for every user or financial regime.

The private replay uses fresh in-memory databases at each historical cutoff, with no future
transactions or backdated manual corrections. Current ledger categories and pairing exclusions
are used as fixed target definitions; original transaction arrival timestamps are unavailable.
Rolling windows overlap. Incomplete/pending transactions can change the eventual actuals.
The detailed local report and reproducible experiment scripts are in the ignored
`analysis/forecast-improvement-2026-09-10/` directory.

## Validation

Regression coverage includes multiple income sources/banks, changing amounts and cadence,
bonuses, early/missing/stopped payments, sparse history, weekly and calendar schedules,
leap years, currency-scale invariance, Unicode source names, future-input exclusion,
classification, user corrections, and prediction/simulation reconciliation.

On Node 26, run the suite with the experimental Web Storage feature disabled so jsdom owns
the browser storage API:

```sh
NODE_OPTIONS=--no-experimental-webstorage npm --prefix app test
npm --prefix renderer run typecheck
npm --prefix renderer run test:unit -- src/features/money-review
```

For realized accuracy of the current version, set `SQLITE_DB_PATH` and run
`npm run evaluate:forecast -- --days 90`. The command is read-only. A new version reports
`collecting` until its own historical snapshots have matured; earlier versions' predictions
are not substituted for them.
