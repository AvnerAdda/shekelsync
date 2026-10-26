# Installment plans and lapsed patterns retrospective check

Version 6 schedules the remaining payments of card installment plans from their payment memo,
stops automatic recurring patterns after 2.5 missed cycles, and no longer learns open-ended
recurring patterns from installment payments. Realized accuracy is recorded under `pattern-v6`.

## Why

A category breakdown of v5 replay errors showed the largest monthly misses came from installment
plans and a stale transfer. A four-payment ₪4,000 appliance plan, a three-payment ₪3,084 furniture
plan and others were either missed while running or projected after their last payment. Two
transfers from December 2025 formed an automatic monthly pattern that was still projected every
month through September. Installment rows already state their remaining payment count; no
prediction is needed for those payments.

## Method

Same replay as earlier reports: cutoffs on the 1st, 8th, 15th and 22nd, fresh in-memory ledgers,
future transactions and manual controls removed, automatic patterns rebuilt, expense debits scored.
The baseline is commit `dd6eac7` (v5). Two ledgers were used, because neither covers the full year:

- Production copy, March–September cutoffs, actuals through September 21. Imports become sparse
  after September 24, so later windows are not scored.
- Development copy, June–October cutoffs, actuals through October 25. History before May is thin.

Windows overlap, current categories are retained and arrival times are unavailable. The changes
were developed while inspecting these ledgers. Only the three October development windows came
after the problem was diagnosed, and they are too few to be a holdout. A tried variant that also
returned lapsed patterns' history to category averages was rejected (see below).

## Mean absolute error in spending

| Ledger | Horizon | Windows | v5 total | v6 total | v5 daily | v6 daily | 90-day average total |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Production | 7 days | 26 | ₪2,372 | ₪2,123 | ₪683 | ₪585 | ₪2,363 |
| Production | 30 days | 24 | ₪7,185 | ₪7,361 | ₪682 | ₪559 | ₪6,756 |
| Development | 7 days | 19 | ₪2,745 | ₪2,406 | ₪693 | ₪636 | ₪3,522 |
| Development | 30 days | 16 | ₪7,985 | ₪6,302 | ₪774 | ₪672 | ₪8,771 |

Daily error improves 8–18% in all four comparisons and weekly total error 11–12%. Monthly total
error improves 21% on the development ledger and worsens 2% on production. Separately:

| Change alone | Production 30-day total | Development 30-day total |
| --- | ---: | ---: |
| Installment schedule | ₪7,185 → ₪6,569 | ₪7,985 → ₪6,188 |
| Pattern lapse | ₪7,185 → ₪8,063 | ₪7,985 → ₪8,002 |

The installment schedule improves every total and daily measure on both ledgers. The lapse rule
improves daily and weekly error, but removes about ₪3,000 of phantom monthly spending that had
partly offset real underprediction. That offset is not a reason to keep projecting a stopped
transfer. Every method still underestimates monthly spending in this period (v6 bias about
−₪6,200 on production): large one-off legal, repair and consulting payments had no prior
evidence. Known upcoming payments should still be entered as category expectations.

Returning a lapsed pattern's transactions to category history was also tried. On production it
let the older category-pattern model turn two December transfers into about ₪7,800 per month of
predicted spending, and daily error rose from ₪585 to ₪753. That variant was removed.

## Reproduction

```sh
npm run replay:forecast -- --db PROD_COPY --from 2026-03-01 --through 2026-09-15 --actual-through 2026-09-21 --category-limit 10
npm run replay:forecast -- --db DEV_COPY --from 2026-06-01 --through 2026-10-22 --actual-through 2026-10-25 --category-limit 10
```

Run the same commands from a worktree at `dd6eac7` for the v5 baseline. Use copies of the
ledgers; the replay opens its source read-only.
