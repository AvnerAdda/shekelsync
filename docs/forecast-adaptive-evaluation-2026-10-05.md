# Adaptive expense selection retrospective check

Pattern v4 adds category-level comparison of the robust monthly incumbent, a 90-day calendar
average, and an estimate weighted toward recent weekly spending. It switches conservatively
using matured historical forecasts and preserves explicit category expectations. New realized
snapshots are recorded under `pattern-v4`.

## Method

The read-only `scripts/replay-forecast-estimators.js` command compares the current model with
selection enabled against the same model with the robust monthly incumbent retained for every
category. Both use the same recurring income, investment, classification, and user-policy code.
This isolates variable spending selection from the earlier v3 changes.

Each cutoff uses a fresh in-memory copy of the local ledger. Future transactions and current
manual corrections/subscriptions are removed, and automatic patterns are rebuilt from available
history. Current categories and pairing exclusions remain fixed. The wall clock is frozen at
each cutoff. Expected expenses are compared with completed expense debits; the whole-ledger
90-day debit average is also reported as a simple comparison. Selection itself uses net category
spending, including refunds. Simulation is disabled; interval coverage is not assessed.

Cutoffs are the 1st, 8th, 15th, and 22nd of March–September 2026. Only complete target windows
ending by October 4 are scored. Windows overlap. Original transaction arrival timestamps are
unavailable, and current classifications may include later edits. Several selection approaches
were inspected during development, so July–September is a later-period comparison rather than
an untouched holdout. One household's historical results do not establish prospective accuracy.

## Mean absolute error in spending totals

| Period | Horizon | Windows | Robust incumbent | Adaptive selection | Whole-ledger 90-day average |
| --- | --- | ---: | ---: | ---: | ---: |
| March–September | 7 days | 28 | ₪2,104 | ₪2,115 | ₪2,374 |
| March–September | 30 days | 25 | ₪5,154 | ₪5,177 | ₪6,513 |
| July–September | 7 days | 12 | ₪3,195 | ₪3,203 | ₪3,658 |
| July–September | 30 days | 9 | ₪5,233 | ₪5,177 | ₪5,570 |

Overall total error increases about 0.5% at both horizons. Later-period monthly error falls
about 1.1%, while weekly error increases 0.2%. Daily MAE decreases slightly: ₪607 to ₪605 over
seven-day windows and ₪685 to ₪683 over thirty-day windows. These are mixed, small differences,
not evidence of a universal accuracy improvement. The v3 improvement over v2 is reported
separately in [the earlier evaluation](forecast-evaluation-2026-10-05.md).

An initial selection rule improved overall weekly and monthly totals but worsened daily and
later-period monthly error. The retained rule requires consistent wins and checks all three
error horizons. The purpose of this change is to adapt when a category's earlier outcomes
support it, while keeping the robust estimate elsewhere. Previously observed gains do not
guarantee that a selected estimate will improve the next forecast.

## Regression evidence

- Constant daily spending selects the calendar average when it beats month-length artifacts.
- Sustained increases and decreases select the recent estimate after sufficient evidence.
- An isolated large purchase does not reset the usual spending rate.
- Sparse history keeps the robust incumbent rather than selecting from immature outcomes.
- Future dates, invalid dates, and today's incomplete feed do not enter candidate estimation.
- Refunds, zero-spending days, input order, and currency scaling preserve the intended behavior.
- Daily totals reconcile with the selected rate, including across month boundaries.
- Explicit monthly expectations override automatic selection and retain remaining-total behavior.

The focused backend suite passes 181 tests across model selection, forecasting, financial
truth, income/investment schedules, and prediction intervals.
An additional 17 forecast and financial-truth API tests pass. Replay validation also checks
date arguments, averaging absolute errors without cancellation, mature horizons, the model
version, and an unchanged source-ledger checksum.

## Reproduction

```sh
npm run replay:forecast -- --from 2026-03-01 --through 2026-09-30 --actual-through 2026-10-04 --split 2026-07-01
```

Set `SQLITE_DB_PATH` or pass `--db PATH`. Run `npm run evaluate:forecast -- --days 90` to measure
newly issued v4 snapshots after their targets mature; historical replay does not replace that
realized accuracy measurement.
