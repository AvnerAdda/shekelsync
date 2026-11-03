# Cash-flow outlook and infrequent expense correction

The previous low-frequency category projection could repeat a full bill on several
likely weekdays. Its `bi-monthly` label came from occurrence counts rather than verified
calendar cadence. Version 5 schedules one inferred bill per supported cycle or adds a
net calendar allowance for irregular costs. Saved financial controls take priority.

The modal's central curve uses expected income less spending. Closing net position
and cash-flow change are separate amounts. Pointwise cumulative simulation bounds
provide the shaded range; cards use the same period and endpoints. They are not
best/worst outcomes or calibrated probability claims. Spending assumptions, refresh,
and a link to review them are visible; the dashboard uses the same expected balance.

Personal balances, income amounts, employer names, and spending totals have been removed.
Relative error comparisons below summarize the original evaluation.

## Diagnostic findings

The correction reduced a diagnostic six-month spending projection while leaving
expected income unchanged. A lower projection alone does not establish improved
accuracy. Bank-balance anchoring is separate from cash-flow change.

A payroll date falling exactly on the cutoff could silently omit an unrecorded receipt
when the outlook began the next day. The corrected schedule carries a recent due
occurrence as awaiting receipt without changing actual bank balance. Recording the
payment suppresses its prediction, and the income-source table exposes the assumption.
Tests use fictional employer names and amounts for this case.

## Historical results

The comparison used 28 seven-day and 25 thirty-day forecasts. Each origin used a fresh
in-memory ledger with future transactions and current manual controls removed. Current
categories and pairing exclusions remained fixed; arrival timestamps were unavailable.
Targets used completed expense debits. Windows overlapped and did not measure
prospective interval coverage.

Daily MAE improved 5.4% and 8.7%. Weekly total MAE increased 6.4%; monthly total MAE
increased 59.9%. Later-period monthly total error also increased. These mixed results
do not establish a general accuracy gain. Repeated bills had offset some missed
irregular spending; removing that compensation exposed the need for planned expenses.

An earlier, narrower trial was removed; see
[the prior follow-up](forecast-follow-up-2026-10-06.md). This version corrects both bill
cadence and low-frequency allowances. Its snapshots use `pattern-v5`.

## Reproduction and regression coverage

```sh
npm run replay:forecast -- --db /path/to/synthetic.sqlite --from 2026-03-01 --through 2026-09-30 --actual-through 2026-10-04 --split 2026-07-01 --compare infrequent --category-limit 10
```

The source opens read-only; forecast generation occurs in memory. Synthetic inputs
exercise the workflow without reproducing private evaluation metrics.

Coverage includes bill cadence, amount changes, multiple accounts, month ends,
early/stopped payments, local timestamps, irregular allowances, refunds, pending
evidence, saved controls, and simulation reconciliation. Outlook tests cover quantiles,
chart/card/driver reconciliation, missing balances, cache refresh, and concurrent
corrections. Renderer tests cover refresh races, retry, and dashboard/modal consistency.
