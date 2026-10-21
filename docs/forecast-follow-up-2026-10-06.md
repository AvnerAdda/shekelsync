# Forecast follow-up: comparison consistency and remaining errors

This report describes the v4 follow-up and its rejected first bill trial. The subsequent
combined bill/allowance change and outlook redesign are documented in
[the v5 evaluation](forecast-outlook-evaluation-2026-10-06.md).

## Retained changes

The selector's robust monthly reference is now reconstructed with the live forecast's capping
function, available ledger months, category age, history-window setting, and active-month
threshold. The earlier reconstruction always considered six calendar months and used a different
cap when zero/refund months were present. It also omitted a month ending at a training origin,
even though that completed month is available to the next day's estimate. Origins with insufficient
active-month history no longer count as wins against a zero-valued monthly reference.

Regression cases compare reconstructed errors with the live forecast at historical origins,
including month ends and missing ledger months. The March–September replay has identical
point estimates and aggregate errors before and after this fix. This is a correctness improvement,
not a measured gain in prediction accuracy on this ledger. The supported model remains v4.

The read-only replay also accepts `--category-limit 10`. It reports category-level MAE, signed bias,
and prediction types. MAE divides by all scored windows, including absent category activity; it
does not divide only by windows in which a category happened to occur. Positive bias indicates
overestimation, negative bias indicates underestimation. No transaction names or identifiers are
printed. The optional report contains category names and aggregate financial errors.

## Remaining opportunities

The largest category errors in this ledger include irregular repair and professional-service
costs, utilities, furniture purchases, and cash withdrawals. Several irregular costs have little
prior evidence and therefore cannot be predicted as dependable recurring payments.

The legacy low-frequency category model is a separate problem. Its `bi-monthly` label comes from
average occurrence counts, rather than a verified two-month cadence. It boosts a day-of-week and
day-of-month score, but does not constrain this category to a single bill. That can forecast the
same utility payment repeatedly in one month. An irregular purchase category can receive similar
treatment even when its actual intervals do not support a bill schedule.

An exploratory change used one calendar payment for categories with consistent merchant/bank
identity and regular recent intervals. Irregular categories received a net calendar daily average.
Saved schedules and corrections were protected. It was evaluated using the same 28 seven-day
and 25 thirty-day windows ending by October 4 as the earlier replay.

| Horizon | Existing total MAE | Trial total MAE | Existing daily MAE | Trial daily MAE |
| --- | ---: | ---: | ---: | ---: |
| 7 days | ₪2,115 | ₪2,251 | ₪605 | ₪578 |
| 30 days | ₪5,177 | ₪8,354 | ₪683 | ₪639 |

The trial reduced daily error by 4.5% and 6.5%, but increased weekly total error by 6.4% and
monthly total error by 61.4%. Later-period monthly results also worsened. The trial was removed
from the application. These retrospective windows overlap, current classifications are retained,
and transaction arrival times are unavailable; the results do not establish prospective accuracy.

Category-level errors explain why looking only at whole-ledger totals can mislead: overestimated
bills can offset missed large purchases. Fixing cadence alone removes that accidental compensation.
Future work should evaluate recurring bills and the allowance for irregular costs together, with
both daily and total errors reported. Known upcoming large payments should continue to use explicit
user expectations rather than an inferred recurring schedule.

## Reproduction

```sh
npm run replay:forecast -- --from 2026-03-01 --through 2026-09-30 --actual-through 2026-10-04 --split 2026-07-01 --category-limit 10
```

The source ledger is opened read-only and historical forecasts run in fresh in-memory copies.
Set `SQLITE_DB_PATH` or pass `--db PATH` to choose a ledger.

## Validation

All 210 focused backend and API tests pass, covering estimator selection, historical baseline
consistency, category error attribution, forecasts, financial truth, recurring income/investments,
and prediction intervals. The full replay preserves the earlier 28- and 25-window point-error
results, restores the wall clock, and leaves the source ledger's SHA-256 checksum unchanged.
