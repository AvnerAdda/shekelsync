# Installment plans and lapsed patterns retrospective check

Version 6 schedules remaining card installments from their payment memo, stops automatic
recurring patterns after 2.5 missed cycles, and no longer learns open-ended recurring
patterns from installments. Realized accuracy is recorded under `pattern-v6`.

Private transaction examples, source-ledger coverage dates, and absolute financial
errors have been removed. Relative results summarize the original retrospective
comparison; they have not been rerun on synthetic data.

## Motivation

Installment payments could be missed while active or projected after their final
payment. Stopped transfers could also persist as automatic monthly patterns.
Installment memos already state the remaining payment count, so those payments can
be scheduled directly without inferring an open-ended recurring pattern.

## Method

The baseline is commit `dd6eac7` (v5). Two private evaluation ledgers were used because
neither covered the full evaluation period. Cutoffs fell on the 1st, 8th, 15th, and
22nd. Each replay used a fresh in-memory ledger with future transactions and manual
controls removed, rebuilt automatic patterns, and scored completed expense debits.
Only windows with sufficient observed actuals were scored.

Windows overlap, current categories remain fixed, and arrival timestamps are unavailable.
Changes were developed while inspecting the inputs. Later windows were too few to
provide a holdout. This evaluation does not establish prospective or general accuracy.

## Relative results

Daily MAE improved 8–18% in all four ledger/horizon comparisons and weekly total error
improved 11–12%. Monthly total error improved 21% on one ledger and worsened 2% on the
other. The installment schedule alone improved every total and daily measure on both.

The lapse rule improved daily and weekly error but removed phantom monthly spending
that had partly offset underprediction. That offset does not justify projecting a
stopped transfer. Unseen one-off payments remain difficult to predict and should use
explicit expectations when known in advance.

Returning lapsed-pattern transactions to category history was also tried. It allowed
older transfers to generate an unsupported recurring estimate and increased daily
error. That variant was removed.

## Reproduction

```sh
npm run replay:forecast -- --db /path/to/synthetic.sqlite --from 2026-03-01 --through 2026-09-15 --actual-through 2026-09-21 --category-limit 10
```

Run the same workflow at `dd6eac7` for a v5 comparison. The replay opens its source
read-only. Synthetic inputs exercise the method without reproducing private metrics;
keep any reports generated from personal ledgers private.
