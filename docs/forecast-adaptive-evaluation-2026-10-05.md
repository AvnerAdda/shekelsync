# Adaptive expense selection retrospective check

Pattern v4 compares the robust monthly incumbent, a 90-day calendar average, and an
estimate weighted toward recent weekly spending at category level. It switches
conservatively using matured historical forecasts and preserves explicit category
expectations. New realized snapshots are recorded under `pattern-v4`.

Personal ledger amounts have been removed. Relative comparisons summarize the original
evaluation and have not been rerun or replaced with invented measurements.

## Method

The read-only `scripts/replay-forecast-estimators.js` command compares selection enabled
against the same model retaining the robust incumbent for every category. Both sides
use the same recurring income, investment, classification, and user-policy code.

Each cutoff uses a fresh in-memory ledger copy with future transactions and current
manual controls removed, automatic patterns rebuilt, and the wall clock frozen.
Current categories and pairing exclusions remain fixed. Targets use completed expense
debits; selection uses net category spending including refunds. Simulation is disabled.

There were 28 complete seven-day and 25 complete thirty-day target windows. Windows
overlap, arrival timestamps are unavailable, and classifications may include later
edits. Several approaches were inspected during development, so the later period is
not an untouched holdout. These results do not establish prospective accuracy.

## Relative error results

Overall total MAE increased about 0.5% at both horizons. Later-period monthly error
fell about 1.1%, while weekly error increased 0.2%. Daily MAE decreased slightly.
These small, mixed differences do not establish a universal accuracy improvement.
The v3 comparison is documented [separately](forecast-evaluation-2026-10-05.md).

An initial selection rule improved overall totals but worsened daily and later-period
monthly error. The retained rule requires consistent wins across all three error
horizons and keeps the robust estimate when evidence is insufficient.

## Regression requirements

- Constant daily spending selects the calendar average when it beats month-length artifacts.
- Sustained increases and decreases select the recent estimate after sufficient evidence.
- An isolated large purchase does not reset the usual spending rate.
- Sparse history retains the incumbent rather than selecting from immature outcomes.
- Future or invalid dates and today's incomplete feed do not enter candidate estimation.
- Refunds, zero-spending days, input order, and currency scaling preserve behavior.
- Daily totals reconcile with the selected rate across month boundaries.
- Explicit monthly expectations retain remaining-total behavior.

## Reproduction

Use a synthetic ledger with suitable history and explicitly set its path:

```sh
npm run replay:forecast -- --db /path/to/synthetic.sqlite --from 2026-03-01 --through 2026-09-30 --actual-through 2026-10-04 --split 2026-07-01
```

A synthetic ledger exercises the workflow; it does not reproduce the private evaluation
metrics. Realized snapshot accuracy can be measured with `npm run evaluate:forecast -- --days 90`
after targets mature. Keep reports generated from personal ledgers private.
