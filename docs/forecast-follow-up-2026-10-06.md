# Forecast follow-up: comparison consistency and remaining errors

This report describes the v4 follow-up and its rejected first bill trial. The subsequent
combined bill/allowance change is documented in
[the v5 evaluation](forecast-outlook-evaluation-2026-10-06.md).
Personal amounts and household-specific spending descriptions have been removed.
Relative results below summarize the original evaluation.

## Retained changes

The selector's robust monthly reference is reconstructed with the forecast's capping
function, available ledger months, category age, history-window setting, and active-month
threshold. The earlier reconstruction always considered six calendar months, used a
different cap with zero/refund months, and omitted a completed month at a training origin.
Origins with insufficient active-month history no longer count as wins against zero.

Regression cases compare reconstructed errors with the forecast at historical origins,
including month ends and missing months. Replay point estimates and aggregate errors
were unchanged. This was a correctness improvement; the supported model remained v4.

The read-only replay accepts `--category-limit 10` to report category MAE, signed bias,
and prediction types. MAE divides by all scored windows, including absent activity.
Positive bias indicates overestimation; negative bias indicates underestimation.
Reports can disclose private category names and financial aggregates even without
transaction names or identifiers, so outputs from personal ledgers must remain private.

## Rejected bill trial

The legacy low-frequency category model used occurrence counts for its `bi-monthly`
label, without verifying a calendar cadence. Day-of-week and day-of-month scores could
repeat a full bill several times in one month.

The trial used one calendar payment for consistent merchant/bank identities with
regular intervals, plus a net calendar daily average for irregular categories. Saved
schedules and corrections were protected. It used the same 28 seven-day and 25 thirty-day
windows as the earlier replay.

Daily error fell 4.5% and 6.5% at the two horizons, but weekly total error rose 6.4%
and monthly total error rose 61.4%. Later-period monthly results also worsened.
The trial was removed. Overestimated bills can offset missed irregular purchases;
removing that compensation requires evaluating cadence and irregular allowances together.

Overlapping retrospective windows, retained classifications, and missing arrival times
limit the conclusions. Known upcoming large payments should use explicit expectations.

## Reproduction

```sh
npm run replay:forecast -- --db /path/to/synthetic.sqlite --from 2026-03-01 --through 2026-09-30 --actual-through 2026-10-04 --split 2026-07-01 --category-limit 10
```

The command opens its source read-only and runs historical forecasts in memory.
Synthetic inputs exercise the method without reproducing the private ledger's results.
Regression coverage includes historical baseline consistency, category error attribution,
forecasting, financial truth, income/investment schedules, and prediction intervals.
