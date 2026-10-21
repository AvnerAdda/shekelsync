# Cash-flow outlook and infrequent expense correction

The previous low-frequency category projection could repeat a full bill on several likely
weekdays. A category's `bi-monthly` label was based on occurrence counts rather than verified
calendar cadence. Version 5 instead schedules one inferred bill per supported calendar cycle,
or adds a net calendar allowance for irregular costs. Saved financial controls take priority.

The modal now uses expected income less spending for its central curve. Closing net position
and projected cash-flow change are separate amounts. Pointwise cumulative simulation bounds
provide the shaded range; the cards use the same period and endpoints. There are no claims of
best/worst outcomes or a calibrated 10% probability. The largest spending assumptions, refresh
and a link to review them are visible. The dashboard preview uses the same expected balance.

## Six-month diagnostic

At the October 1 historical cutoff, six-month expected spending falls from ₪236,219 to
₪154,707, with expected income unchanged at ₪147,533. Recent recorded six-month expense
debits total ₪130,289. This is a diagnostic comparison on the local ledger, not a future
actual or the exact projection shown in the supplied screenshot. Lower spending alone is
not evidence of improved accuracy. Bank balance anchoring is separate from cash-flow change.

At the live October 6 cutoff, Deloitte's regular payment date fell on the cutoff itself.
The outlook started October 7, so it included November–March salary but silently lost
October's unrecorded receipt. The corrected schedule carries that recent due occurrence
as awaiting receipt. In a read-only copy preserving saved controls, forecast income rises
from ₪130,088 to ₪147,533 by restoring the typical ₪17,444.79 salary. The current bank
balance is unchanged. Once an actual payment is recorded, the corresponding prediction
is suppressed. The income-source table makes this assumption visible.

## Historical results

The comparison uses 28 seven-day and 25 thirty-day forecasts at March–September cutoffs,
with targets observed through October 4. Each origin uses a fresh in-memory ledger with
future transactions and current manual controls removed. Current categories and pairing
exclusions remain fixed; transaction arrival timestamps are unavailable. Targets use expense
debits, matching earlier replay reports. The overlapping windows are retrospective and do
not measure prospective interval coverage.

| Horizon | v4 total MAE | v5 total MAE | v4 daily MAE | v5 daily MAE |
| --- | ---: | ---: | ---: | ---: |
| 7 days | ₪2,115 | ₪2,250 | ₪605 | ₪573 |
| 30 days | ₪5,177 | ₪8,280 | ₪683 | ₪623 |

Daily error improves by 5.4% and 8.7%. Weekly total error increases by 6.4%; monthly total
error increases by 59.9%. July–September monthly total MAE increases from ₪5,177 to ₪9,925,
while daily MAE improves from ₪988 to ₪835. Neither the lower projection nor these daily
results establish a general accuracy gain. Inflated bills previously offset some missed
large irregular purchases; removing that compensation exposes the need for better planned
expense information. No parameter was adjusted to reproduce a desirable closing balance.

An earlier narrower bill trial was removed; its results remain documented in
[the prior follow-up](forecast-follow-up-2026-10-06.md). This version corrects both automatic
bill cadence and the allowance for other low-frequency expense patterns. Its accuracy
snapshots use `pattern-v5` and remain separate from earlier versions.

## Reproduction and validation

```sh
npm run replay:forecast -- --from 2026-03-01 --through 2026-09-30 --actual-through 2026-10-04 --split 2026-07-01 --compare infrequent --category-limit 10
```

The incumbent disables only the new infrequent-expense replacement; both sides retain the
same adaptive spending selector. Set `SQLITE_DB_PATH` or pass `--db PATH` for another ledger.
The source opens read-only; all forecast generation and materialization occur in memory.

Regression coverage checks bill cadence, amount changes, multiple accounts, month ends,
early/stopped payments, local timestamp imports, irregular cost allowances, refunds,
future/pending evidence, saved controls and simulation reconciliation. Backend outlook
tests cover quantile selection, chart/card/driver reconciliation, missing/zero balances,
refund history, cache refresh and concurrent financial truth changes. Renderer checks
cover refresh races, unavailable ranges, retry and dashboard/modal consistency.
