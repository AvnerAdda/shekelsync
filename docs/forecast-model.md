# Pattern forecast version 6

The application runs one pattern model. The retired model, background comparison runs,
comparison API, and comparison UI have been removed. Prediction snapshots use `pattern-v6`
so accuracy observations from the previous implementation are not mixed with the new one.
Existing snapshot schemas and historical records are retained.

## Installment plans and lapsed patterns

Card installment payments carry `type = 'installments'` and a memo such as "תשלום 2 מתוך 4".
Like the card scrapers, the first two numbers are read as payment number and total. A plan is
identified by bank, account, normalized merchant name, payment total and implied purchase month.
After its latest observed payment, each remaining payment is scheduled on the purchase day of
later months, clamped at month end, with the latest payment amount. Nothing is scheduled after
the final payment. Each projected date uses the same stored UTC-day bucket as the imported charge.

Later payments (number 2 onward) are removed from category spending history, because the plan
schedules them. The first payment remains as evidence of new installment purchases. Installment
transactions do not create automatic recurring patterns, which would otherwise continue a
four-payment plan indefinitely. A saved category expectation keeps its category on the previous
behaviour. Pending, future and refunded rows are ignored.

An automatic recurring pattern stops projecting once more than 2.5 cycles have passed since its
last observed charge, the same rule as detected income and investment schedules. Confirmed,
overridden, imported legacy subscription and other user-backed patterns are unchanged. A lapsed
pattern's history remains excluded from category averages: returning it let the older category
model project long-stopped transfers again. See [the v6 evaluation](forecast-installments-evaluation-2026-10-26.md).

A recurring pattern whose name matches a bank debit paired with an imported card (for example
"חיוב לכרטיס ויזה 9144") is never projected, whatever its source. Paired debits are already
excluded from history and actuals because the card's purchases record that spending; imported
legacy subscriptions for these debits previously added it a second time. The replay removes
legacy subscriptions, so this live-app double count did not appear in replay accuracy.

## Income and classification

Forecast evidence and outlook history use the assigned category's type, falling back to the
transaction type for uncategorized entries, just as Activity does. A completed salary receipt
with a stale imported expense type therefore clears its expected income occurrence.

Automatic recurring income learns timing separately from amount. It groups observations by
category, bank/vendor, and normalized source name, preserving Unicode and numeric source
identities. The payment amount is the median of the latest three observations. Cadence is
inferred from recent intervals, with monthly calendar anchors and separate handling for
weekly, biweekly, twice-monthly, quarterly, and annual receipts.

Three observations are required before replacing the existing projection for a category.
One unusual bonus does not become the recurring amount. Early receipts suppress the matching
future occurrence, month-end anchors respect February and leap years, and a detected stream
becomes inactive after 2.5 missed cycles. Explicit schedules bypass automatic inference.

When an outlook starts tomorrow, a recently due receipt without a matching recorded payment
is carried to the first forecast day and marked awaiting receipt. The grace period is at
most ten days and less than half a cycle; old missed cycles are not accumulated. A matching
actual or an early payment suppresses that occurrence. This fixes the missing current-month
salary at a cutoff on or just after its expected date without adding it to actual balances.
The outlook lists expected income sources and identifies awaiting receipts explicitly.

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

## Variable spending and uncertainty

Low-frequency automatic expense categories no longer repeat a full bill across likely
weekdays. At least three payment dates with consistent merchant/bank identity, calendar
intervals, payment days, and amounts establish one payment per inferred cycle. Multiple
accounts paid on the same day are combined. Monthly, two-month, quarterly, six-month and
annual cadences respect month ends and leap years. Early payments suppress an occurrence,
and an inferred bill stops after 2.5 missed cycles.

Other low-frequency expenses receive an allowance based on net spending over up to 180
completed calendar days, including zero-spend days and refunds. At least 90 days of feed
coverage are required. This allowance estimates cost, not an exact purchase date. Pending,
future and incomplete current-day evidence do not inflate the allowance. Saved schedules,
corrections, paused patterns and category expectations remain authoritative. Ordinary
frequent spending retains the adaptive variable estimator described below.

These changes correct duplicated bills; they do not establish an overall improvement in
forecast accuracy. In the local historical replay, daily errors improve while monthly
total errors worsen. See [the v5 evaluation](forecast-outlook-evaluation-2026-10-06.md).

Automatic variable spending selects an ongoing daily rate using past forecast comparisons.
Spending above the typical monthly total does not make future spending zero. Category
estimates are spread across covered calendar days; they do not claim exact purchase dates.
Occurrence frequency is normalized by the full month's length so a shorter request does
not change the inferred daily activity rate. Explicit monthly category expectations retain
the user's remaining-total policy. Inferred schedules, confirmed schedules, and everyday
spending are distinguished in transaction details without percentage probability claims.

Simulated amounts use a positive lognormal distribution with the requested arithmetic mean
and variance. This avoids the upward mean bias from clipping a Gaussian at zero. Resolved
recurring events use the full scheduled amount in both the expected forecast and simulations;
the pattern's confidence score is not treated as a calibrated probability of cancellation.

The API's `predictionIntervals.daily` contains the p10/p50/p90 distributions for each day's
cash flow, operating cash flow, expenses, cumulative cash flow, and cumulative operating
cash flow. Cumulative distributions are computed from cumulative simulation paths rather
than by summing daily percentiles. Whole scenario paths remain available separately. The
Net Position chart and extended forecast use the cumulative distributions, and the range
area renders its actual lower and upper endpoints. Daily accuracy snapshots store the daily
quantiles. These are model estimates; their construction does not prove calibrated coverage.
The range has a solid shaded fill with a visible legend colour in light and dark themes.
Its outline is hidden through opacity: a transparent stroke also makes Recharts' legend
text transparent. Browser regression checks verify paint colour as well as geometry.

The six-month cash-flow outlook displays an expected line from deterministic expected
income less expected spending, with pointwise simulated bounds. Its summary cards separate
closing net position from cash-flow change, and share the chart's backend horizon and
endpoints. Income and spending totals belong to the expected forecast only: quantile bounds
do not invent paired income/expense paths. Lower/upper labels make no calibrated probability
claims. The outlook shows its largest spending assumptions and links to their review.
Each active bank account contributes its latest cash snapshot. Foreign balances are converted
to shekels with the recorded exchange rates; missing or stale rates and missing account balances
make the total unavailable instead of exposing a partial sum. These cases are clearly marked as
cash-flow changes from zero; missing intervals remain unavailable. Refresh and saved financial corrections invalidate both backend and renderer
caches, and older responses cannot replace a later correction.

Snapshots preserve the first issued estimate for each date/revision/model, and scoring uses
the first issued snapshot per origin/target/model so revision churn does not multiply samples.
The new version begins its own accuracy history. The UI's percentage spending error uses
weighted absolute percentage error across all scored spending days, including zero-spend
days, rather than an average of percentages dominated by tiny daily actuals. Readiness alone
does not produce a green accuracy badge. Future-dated transactions are excluded from the
model's historical input. Actual spending nets expense refunds in both budget outlooks and
accuracy scoring, including negative spending on refund-only days. Percentage errors divide
by absolute actual spending so refunds cannot cancel the denominator. By default, budget
outlooks compare month-to-date actuals plus forecasts from tomorrow through month-end against
the full monthly budget. A shorter requested chart horizon gets a separate month-end budget
forecast, while its daily results and summaries retain the requested horizon. An explicit
budget lookback of N days includes exactly N calendar
dates through today, including timestamped transactions today, against N/30 of the monthly
budget; future forecasts are excluded from this historical comparison.

### Adaptive variable spending

Each eligible category compares its existing robust monthly estimate with a 90-calendar-day
net spending average and a recent spending estimate. The recent estimate weights twelve weekly
totals with a four-week half-life. Isolated large weeks are capped using the median and median
absolute deviation; adjacent similar high weeks are retained as evidence of a sustained change.
Refunds reduce spending and calendar days without purchases count in the averages.

Selection uses up to twelve weekly historical origins, each with at least ninety training days
and fully observed seven- and thirty-day targets. At least six origins are required. Candidates
at each origin use only earlier evidence. Today's possibly incomplete imports and future dates
are excluded from estimation. Daily estimator history is limited to the preceding 365 days.

The historical robust candidate uses the same monthly capping function, category age policy,
ledger months, configured history window, and minimum active-month requirement as the live
forecast. A month ending at the training origin is available to the next day's estimate.
Origins without an eligible robust baseline are not scored as challenger wins.
Complete month totals are retained for the monthly reference: at older origins, its configured
monthly window can reach before the rolling daily history window.

The robust monthly estimate remains the incumbent. A simple average must reduce both weekly
and monthly error by at least 5%, win at least 60% of origins, and keep daily error within 1% of
the incumbent. The recent estimate must reduce combined error by at least 10%, win at least 60%
of origins, and keep daily, weekly, and monthly errors within 1% of the selected reference.
Combined error averages absolute total errors divided by each horizon's length. An isolated
spike that raises the current simple average more than 25% above the capped weekly rate restores
the robust estimate. Sparse history also retains the robust estimate.

Selected rates apply consistently across covered calendar days and month boundaries. Explicit
category expectations still take precedence. Selection is internal to the existing forecast;
the app adds no model selector or experimental labels. The new model version starts separate
realized accuracy history, preserving older observations without mixing their results.

## Selection and evaluation

### Investment schedules

Investment forecasts learn each source separately using category, bank, account, normalized
transaction name, and transfer direction. Payments from the same source on the same local
calendar day are combined before learning a schedule. UTC timestamps are converted to local
payment dates so midnight bank imports do not shift the inferred day into the previous month.

Three regular observations are normally required (four for weekly transfers). The latest
three payment amounts determine the median amount and the recent dates determine the calendar
anchor, including month-end and leap years. Contributions and withdrawals remain separate
signed streams. Irregular lump sums and sparse property transfers are not projected as recurring
payments, and pikadon-related transactions remain outside the dashboard investment forecast.
Already-paid occurrences are suppressed, including early payments across a month boundary;
inferred streams expire after 2.5 missed cycles.

A narrowly identified mortgage payment can establish an initial monthly estimate from its
first debit. Mortgage fees, insurance, and payoff descriptions do not qualify. This rule uses
the observed amount and local payment day, not a hard-coded account, amount, or date. Dates
remain estimates: bank holidays and future payment changes are not inferred from one debit.

Unconfirmed imported subscriptions are reconciled with this transaction evidence. Manual,
confirmed, corrected, paused, ended, and suppressed patterns remain authoritative. Explicit
investment schedules are classified as investments rather than income or expenses. Forecast
totals, transaction details, and simulation inputs use the same signed investment events.

Investment validation includes source separation, outlier resistance, changes in amounts and
dates, short/irregular histories, new mortgages, local timestamps, saved controls, and signed
simulation reconciliation. A read-only March–August replay of the local ledger was also used
to check that one-off property purchases no longer inflate subsequent months; it is an
exploratory historical check, not evidence of prospective prediction accuracy.

### Net Position investment forecast

Only the Net Position chart adds an expected forecast line after investing, beside
the existing forecast before investing. Both start at the same historical net
position. Each future day's signed investment transfer is subtracted from its
cash flow: contributions lower the new line and withdrawals raise it. Missing
investment data stops the new cumulative line instead of assuming zero. Existing
scenario lines and API cash-flow fields remain on the before-investing basis.

### Earlier income and expense evaluation

Development compared calendar averages, medians, exponentially weighted estimates, payment
schedules, shorter expense windows, and adaptive expense estimators. Parameters were selected
on March–June transaction outcomes; July–August was excluded from parameter selection.
Because the later period was also inspected while diagnosing failed approaches, these are
exploratory retrospective results, not an untouched prospective trial.

The retained income defaults were a three-observation median and the learned payment date.
Earlier expense parameter changes did not generalize consistently and were rejected in v2.
The v3 rate and timing changes are evaluated in [the October evaluation](forecast-evaluation-2026-10-05.md).
The v4 adaptive selection is evaluated in [the adaptive evaluation](forecast-adaptive-evaluation-2026-10-05.md).
Classification corrections still change some expense
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

For a read-only retrospective comparison of adaptive selection against the robust incumbent:

```sh
npm run replay:forecast -- --from 2026-03-01 --through 2026-09-30 --actual-through 2026-10-04 --split 2026-07-01
```

Set `SQLITE_DB_PATH` or pass `--db PATH` to choose the ledger. Choose `--actual-through` as the
last complete day of imported transactions. The command freezes historical time and rebuilds
automatic patterns in fresh in-memory databases, without modifying the source ledger. Its JSON
contains aggregate errors, not transaction details. It compares point estimates; it does not
evaluate prediction interval coverage or prospective performance.
Pass `--category-limit 10` to include the largest category errors, their signed bias, and the
types of predictions that contributed. Category MAE uses all scored windows as its denominator,
including windows with neither a prediction nor an actual expense for that category. Opposing
category biases can cancel in whole-ledger totals, so both views are needed when evaluating changes.
Pass `--compare infrequent` to compare the current model with the same model's bill/allowance
replacement disabled; the default comparison retains that replacement on both sides and
isolates adaptive variable spending. These switches exist only in the read-only evaluation
script, not in the application.
