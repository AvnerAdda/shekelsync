# Forecast v3 retrospective check

The changes replace the automatic monthly remaining-total ceiling with an ongoing spending
rate, spread variable category estimates across calendar days, calculate quantiles separately
at each date, and correct range rendering and inferred-payment wording. Recurring income,
investment schedules, and explicit user corrections remain available. New realized accuracy
is recorded under `pattern-v3`; older snapshots are retained but not scored as v3 observations.

## Method

Compared the pre-change v2 implementation and v3 on the local ledger at 28 cutoffs: the 1st,
8th, 15th, and 22nd of each month from March through September 2026. Each cutoff used a fresh
in-memory ledger, removed future transactions and current manual corrections/subscriptions,
and rebuilt automatically detected patterns from the history available at that cutoff.
Current categories and pairing exclusions were retained as fixed target definitions.

Expected expense totals were compared with realized completed expense debits. A simple
baseline used the previous 90 calendar days' spending divided by 90. This check disabled
simulation for deterministic point estimates; it does not measure interval coverage. There
were 28 complete seven-day windows and 25 complete thirty-day windows ending by October 4.

The design was fixed before inspecting these replay results. March–June and July–September
are reported separately; the later dates are not an untouched prospective holdout, since the
ledger has previously been inspected. Windows overlap, original transaction arrival times
are unavailable, and current ledger categories can reflect subsequent edits. These results
describe one household's historical ledger and do not prove general or prospective accuracy.

## Mean absolute error in spending totals

| Period | Horizon | Windows | v2 | v3 | 90-day average |
| --- | --- | ---: | ---: | ---: | ---: |
| March–September | 7 days | 28 | ₪2,293 | ₪2,104 | ₪2,374 |
| March–September | 30 days | 25 | ₪5,581 | ₪5,154 | ₪6,513 |
| July–September | 7 days | 12 | ₪3,524 | ₪3,195 | ₪3,658 |
| July–September | 30 days | 9 | ₪5,502 | ₪5,233 | ₪5,570 |

Across all cutoffs, total error fell 8.2% at seven days and 7.7% at thirty days. In the later
period it fell 9.3% and 4.9%, respectively. Daily expense MAE across seven-day windows changed
from ₪618 to ₪607; across thirty-day windows it changed from ₪696 to ₪685. Improvements are
modest and daily prediction remains difficult. The lower error in this replay does not
replace measurement of newly issued v3 forecasts as they mature.

## Regression requirements

- Spending remains positive after an inferred monthly baseline is exceeded; an explicit user
  expectation retains its remaining-total behavior.
- Short forecast windows preserve the inferred daily activity frequency.
- Daily and cumulative quantiles remain ordered even when example paths cross.
- Cumulative quantiles are calculated across cumulative paths, not summed daily quantiles.
- Snapshots use daily quantiles and do not overwrite the first estimate.
- The chart range uses both endpoints on gross and operating bases; legacy responses without
  intervals do not display an uncertainty band.
- Transaction details distinguish scheduled payments, estimated dates, and typical daily
  spending, while their contributions still reconcile with chart totals.
- Accuracy percentages include zero-spending misses and reject reversed intervals.
