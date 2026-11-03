# Forecast v3 retrospective check

The changes replace the automatic monthly remaining-total ceiling with an ongoing
spending rate, spread variable category estimates across calendar days, calculate
quantiles separately at each date, and correct range rendering and inferred-payment
wording. Recurring income, investment schedules, and explicit user corrections remain
available. New realized accuracy is recorded under `pattern-v3`.

Personal ledger amounts have been removed from this report. Relative comparisons
below summarize the original retrospective evaluation; they are not synthetic results
or a new evaluation.

## Method

Compared v2 and v3 at 28 historical cutoffs using fresh in-memory ledger copies.
Future transactions and current manual corrections/subscriptions were removed, and
automatic patterns were rebuilt from the history available at each cutoff. Current
categories and pairing exclusions were retained as fixed target definitions.

Expected expense totals were compared with completed expense debits and a baseline
using the prior 90 calendar days' spending divided by 90. Simulation was disabled.
There were 28 complete seven-day windows and 25 complete thirty-day windows.

Windows overlap, original transaction arrival times are unavailable, and current
categories can reflect subsequent edits. The later-period comparison was not an
untouched prospective holdout. A single private ledger does not establish general
or prospective accuracy, and this check does not measure interval coverage.

## Relative error results

| Comparison | Seven-day total MAE reduction | Thirty-day total MAE reduction |
| --- | ---: | ---: |
| All cutoffs | 8.2% | 7.7% |
| Later-period cutoffs | 9.3% | 4.9% |

Daily prediction improvements were modest. Lower replay error does not replace
measurement of newly issued forecasts as they mature.

## Regression requirements

- Spending remains positive after an inferred baseline is exceeded; an explicit
  user expectation retains remaining-total behavior.
- Short windows preserve inferred daily activity frequency.
- Daily and cumulative quantiles remain ordered when example paths cross.
- Cumulative quantiles are calculated across cumulative paths, not summed daily quantiles.
- Snapshots use daily quantiles and do not overwrite the first estimate.
- Chart ranges use both endpoints on gross and operating bases; legacy responses
  without intervals do not display an uncertainty band.
- Details distinguish scheduled payments, estimated dates, and typical daily
  spending, while contributions reconcile with chart totals.
- Accuracy percentages include zero-spending misses and reject reversed intervals.
