I scanned the repo and there are several genuinely interesting engineering stories worth sharing. The strongest LinkedIn angles are these:

**1. Privacy-first AI for personal finance**

You built a financial chatbot/context system that sends useful aggregates to AI while anonymizing sensitive merchant/profile data. The clever part is preserving financial signal, like categories, amounts, dates, trends, and budgets, while replacing merchant names with stable labels like `Merchant_1`.

Post angle:

> Building AI features for finance is not just about prompts.  
> The harder problem is deciding what data the model should never see.
>
> In ShekelSync, we built a privacy-aware financial context layer:
> - merchants are anonymized per conversation
> - account numbers are masked
> - age/income are coarsened into bands
> - permissions decide which data enters the AI context
>
> The goal was simple: useful financial insights without casually leaking personal financial identity.

Relevant files:
- [data-anonymizer.js](/home/addavner/shekelsync/app/server/services/chat/data-anonymizer.js)
- [financial-context.js](/home/addavner/shekelsync/app/server/services/chat/financial-context.js)

**2. Israeli banking scraper orchestration inside Electron**

The scraper layer is more than “call an API”. It handles multiple Israeli institutions, different credential shapes, browser launch quirks, progress events, audit rows, category mapping, deduplication, and background sync.

Post angle:

> One underrated challenge in personal finance apps: every bank speaks a slightly different dialect.
>
> For ShekelSync, the scraper integration had to normalize:
> - banks vs credit cards
> - different credential formats
> - headless vs visible browser flows
> - Chrome paths across macOS, Windows, Linux
> - duplicate transaction prevention
> - live progress events back to the UI
>
> Most of the work was not scraping itself. It was making scraping feel boring and reliable for the user.

Relevant files:
- [scraper.js](/home/addavner/shekelsync/electron/scraper.js)
- [sync-scheduler.js](/home/addavner/shekelsync/electron/sync-scheduler.js)
- [bulk.js](/home/addavner/shekelsync/app/server/services/scraping/bulk.js)

**3. Financial health score built from real behavioral signals**

The health score is not just “income minus expenses”. It uses savings rate, category entropy, micro-spending share, runway, volatility, and confidence notes when the data is weak.

Post angle:

> I didn’t want a financial health score that was just a vanity number.
>
> In ShekelSync, the score is built from several behavioral signals:
> - savings rate
> - spending diversity
> - impulse/micro-spend share
> - runway based on burn rate
> - month-to-month volatility
> - confidence notes when the data is thin
>
> A good score should explain itself. Otherwise users cannot trust it.

Relevant file:
- [health-score-enhanced.js](/home/addavner/shekelsync/app/server/services/analytics/health-score-enhanced.js)

**4. Smart matching between credit card payments and bank transactions**

This is a very local, domain-specific feature. The app detects likely settlement transactions using Hebrew/English vendor aliases, card digits, nicknames, repayment categories, and confidence scoring.

Post angle:

> Some of the best product engineering happens in domain-specific edge cases.
>
> In Israeli banking data, credit card spending and bank repayments often appear in different places, with different names.  
> So ShekelSync has a smart matcher that links them using:
> - Hebrew and English vendor aliases
> - card/account digit patterns
> - repayment category detection
> - nickname matching
> - confidence scoring
>
> It is not flashy ML. It is practical product intelligence.

Relevant file:
- [smart-match.js](/home/addavner/shekelsync/app/server/services/accounts/smart-match.js)

**5. Subscription detection from recurring transaction patterns**

The app detects subscriptions by analyzing recurring financial patterns, then merges detected patterns with user-managed subscription records. It also estimates next expected charge dates and monthly/yearly cost.

Post angle:

> Subscription tracking sounds simple until you realize users rarely label subscriptions manually.
>
> In ShekelSync, subscriptions are detected from recurring transaction behavior:
> - frequency detection
> - consistency scoring
> - monthly cost normalization
> - next expected charge dates
> - merge between detected and manually edited subscriptions
>
> The product lesson: automate discovery, but let the user stay in control.

Relevant file:
- [subscriptions.js](/home/addavner/shekelsync/app/server/services/analytics/subscriptions.js)

**6. Forecasting without an external ML service**

The forecast engine runs locally, reads from SQLite, detects historical patterns, uses configurable Monte Carlo runs, caches results, and forecasts income/expenses/investments.

Post angle:

> Not every “AI” feature needs a cloud model.
>
> For ShekelSync’s financial forecast, we built a local forecasting engine:
> - reads directly from the local SQLite database
> - analyzes historical category patterns
> - models recurring income and expenses
> - supports Monte Carlo simulation
> - caches forecast results
>
> For personal finance, local-first forecasting is a strong default: faster, cheaper, and more private.

Relevant file:
- [forecast.js](/home/addavner/shekelsync/app/server/services/forecast.js)

**7. SQLite/Postgres portability as a product strategy**

The code has a dialect abstraction for date truncation, formatting, extraction, numeric casts, FTS search, and finance-specific exclusions. That is a nice engineering story because the app can stay local-first while still supporting server-style workflows.

Post angle:

> Local-first apps still need serious backend architecture.
>
> ShekelSync supports SQLite-first desktop usage, while keeping many services portable to Postgres through a small SQL dialect layer.
>
> That layer handles:
> - date truncation
> - date formatting
> - numeric casting
> - full-text search
> - finance-specific query clauses
>
> Small abstraction, big leverage.

Relevant file:
- [sql-dialect.js](/home/addavner/shekelsync/app/lib/sql-dialect.js)

**8. Security posture as a visible product feature**

The app exposes encryption/keychain/biometric status as a unified security status. That is useful because security is not hidden in config; it becomes understandable to the user.

Post angle:

> For a finance app, “we encrypt data” is not enough.
>
> Users should know what protection is active.
>
> In ShekelSync, the app builds a security status from:
> - AES-256-GCM encryption
> - OS keychain availability
> - biometric auth availability
> - re-auth timeout
> - platform-specific fallbacks
>
> Security should be inspectable, not just promised.

Relevant file:
- [security-status.js](/home/addavner/shekelsync/electron/security/security-status.js)

My top 3 for LinkedIn would be: privacy-first AI, Israeli bank scraper orchestration, and the explainable financial health score. Those are the most distinctive and easiest to explain to both engineers and product people.

---

## Image / diagram ideas for the existing posts

### 1. Privacy-first AI for personal finance

Best image: **Privacy-aware AI context pipeline**

```text
Local financial data
        ↓
Permission filter
        ↓
Anonymizer
        ↓
AI context
```

Show the transformation:

```text
Before:
John, age 34, exact income, real merchants, account 123456789

After:
Age band: 30-39
Income band: ₪20,000-₪39,999
Merchant_1, Merchant_2
Account: ****6789
```

Caption:

> Useful AI context without exposing raw financial identity

### 2. Israeli banking scraper orchestration inside Electron

Best image: **Banking dialects to normalized sync pipeline**

```text
Hapoalim       userCode + password
Discount       id + password + num
Yahav          username + password + nationalID
Amex           id + card6Digits + password
Visa Cal / Max username + password
        ↓
ShekelSync Scraper Adapter
        ↓
Clean transactions + progress events + duplicate prevention
```

Inside the adapter, show chips:

```text
credential normalization
browser mode selection
Chrome path detection
duplicate hash
audit row
live UI progress
```

Caption:

> Making messy bank integrations feel boring

### 3. Financial health score built from real behavioral signals

Best image: **Product screenshot + score formula slide**

Use the existing score trend modal screenshot as slide 1. It already shows that the score has component lines, not just one number.

Slide 2:

```text
Health Score
= Savings behavior
+ Spending diversity
+ Micro-spend discipline
+ Runway
- Volatility penalty
+ Confidence notes
```

Caption:

> A financial health score should explain itself

### 4. Smart matching between credit card payments and bank transactions

Best image: **Before / after matching diagram**

```text
Credit card side
MAX card ending 1234
- Supermarket ₪214
- Fuel ₪180
- Restaurant ₪96
Total: ₪490

Bank side
"מקס כרטיס אשראי 1234"
-₪490

        ↓
ShekelSync smart matcher
Hebrew alias: מקס
English alias: max
Digits: 1234
Category: credit card repayment
Confidence: 92%

        ↓
Linked repayment
MAX card bill ↔ Bank repayment
No double-counting
Cleaner cashflow
```

Caption:

> Turning messy bank text into reliable financial structure

### 5. Subscription detection from recurring transaction patterns

Best image: **Recurring pattern detection diagram**

```text
Raw transactions
Netflix  15 Mar  ₪69.90
Netflix  15 Apr  ₪69.90
Netflix  15 May  ₪69.90

Spotify  02 Mar  ₪21.90
Spotify  02 Apr  ₪21.90
Spotify  03 May  ₪21.90

        ↓
Detection engine
Frequency: monthly
Consistency: 96%
Monthly cost: ₪91.80
Next expected: 15 Jun / 03 Jun
Status: review

        ↓
User-controlled list
Netflix  ₪69.90 / month  Next: 15 Jun  [Keep] [Edit] [Ignore]
Spotify  ₪21.90 / month  Next: 03 Jun  [Keep] [Edit] [Ignore]
```

Caption:

> From transaction noise to subscriptions users can actually manage

### 6. Forecasting without an external ML service

Best image: **Forecast chart with confidence band**

Show a 30-day projected cashflow/balance line with a shaded range.

Add small labels:

```text
salary expected
rent expected
subscriptions expected
card repayment expected
```

Architecture side note:

```text
Local SQLite DB
↓
Historical transactions
↓
Pattern analyzer
↓
Recurring income / expenses
↓
Monte Carlo simulation
↓
30-day forecast
```

Caption:

> Forecasting personal finance locally: private, fast, and practical

### 7. SQLite/Postgres portability as a product strategy

Best image: **Code + output split**

Left:

```js
dialect.dateTrunc('month', 't.date')
dialect.ftsSearch('t', '$1')
dialect.castNumeric('price')
```

Right:

```text
SQLite:
strftime(...)
FTS5 MATCH
CAST(price AS REAL)

Postgres:
DATE_TRUNC(...)
ILIKE
price::numeric
```

Caption:

> One code path, two database engines

### 8. Security posture as a visible product feature

Best image: **Security posture dashboard**

```text
Security Status: Protected

Encryption
AES-256-GCM active

Key Storage
OS keychain connected

Authentication
Biometric available
Last authenticated: 2h ago
Re-auth required after: 24h

Platform
macOS / Windows / Linux fallback checks
```

Caption:

> Security users can inspect, not just trust

---

## Additional LinkedIn angles worth adding

### 9. Smart notifications that understand financial context

Post angle:

> Notifications in finance apps should not be noisy.
>
> In ShekelSync, alerts are generated from financial context:
> - budget warnings
> - projected overruns
> - unusual spending
> - high transactions
> - recurring payments due
> - stale sync detection
> - uncategorized transaction reminders
>
> The product goal is not "more notifications". It is fewer alerts that are actually worth interrupting the user for.

Best image: **Notification decision pipeline**

```text
Recent transactions
Budgets
Forecast
Recurring patterns
Sync state
        ↓
Notification engine
        ↓
Severity:
info / warning / critical
        ↓
User-facing alert
```

Example alert cards:

```text
Projected budget overrun
Food category is on pace to exceed budget by ₪420

Recurring payment due
Netflix expected on Jun 15

Stale sync
Hapoalim has not synced in 7 days
```

Caption:

> Financial notifications should be contextual, not noisy

Relevant file:
- [notifications.js](/home/addavner/shekelsync/app/server/services/notifications.js)

### 10. Investment account suggestions from transaction text

Post angle:

> Investments often leak into bank data as messy transaction descriptions.
>
> ShekelSync uses those descriptions to suggest investment accounts:
> - pension funds
> - provident funds
> - study funds
> - brokerages
> - crypto platforms
> - savings accounts
>
> The app extracts account type, institution hints, clean names, and confidence scores, then lets the user approve the suggestion.

Best image: **Transaction text to investment account suggestion**

```text
Raw transaction
"העברה למנורה קרן פנסיה"
        ↓
Pattern analyzer
Matched: pension
Institution: מנורה
Confidence: 87%
Reason: matched pension keywords
        ↓
Suggested account
קרן פנסיה - מנורה
[Create account] [Ignore]
```

Caption:

> Turning hidden investment signals into user-reviewable structure

Relevant files:
- [suggestion-analyzer.js](/home/addavner/shekelsync/app/server/services/investments/suggestion-analyzer.js)
- [auto-linker.js](/home/addavner/shekelsync/app/server/services/investments/auto-linker.js)

### 11. Rule-based categorization that improves over time

Post angle:

> Transaction categorization does not always need a model.
>
> In ShekelSync, merchant patterns are matched against active categorization rules:
> - longer pattern matches win
> - priorities break ties
> - category hierarchy is resolved
> - confidence scores are stored
> - bulk categorization can improve old transactions
>
> It is simple, explainable, and easy for users to correct.

Best image: **Merchant rule matching flow**

```text
Transaction:
"Wolt Tel Aviv"
        ↓
Rules:
"wolt" → Food / Delivery
"tel aviv" → lower confidence
        ↓
Best match:
Food / Delivery
Confidence: 0.8
        ↓
Transaction updated
auto_categorized = true
```

Caption:

> Explainable categorization beats mysterious automation

Relevant file:
- [categorize-transaction.js](/home/addavner/shekelsync/app/server/services/categorization/categorize-transaction.js)

### 12. User-owned financial data export

Post angle:

> Local-first finance apps should make leaving easy.
>
> ShekelSync includes structured exports for:
> - transactions
> - categories
> - vendors
> - budgets
> - full data snapshots
>
> Data ownership is not only about where data is stored. It is also about whether users can take it with them.

Best image: **Export architecture card**

```text
Local database
        ↓
Date/category filters
        ↓
Export service
        ↓
CSV / JSON
        ↓
User-owned file
```

Show a small sample:

```text
Date, Vendor, Description, Amount, Category, Institution
2026-05-01, max, Merchant_1, -69.90, Food, Max
```

Caption:

> Data ownership means export has to be boring and reliable

Relevant file:
- [export.js](/home/addavner/shekelsync/app/server/services/data/export.js)
