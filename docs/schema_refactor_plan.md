# SQLite Schema Normalisation Plan

Status note (2026-06-25): this is a historical plan. The current `transactions` table has already dropped legacy `category`, `parent_category`, and `subcategory` columns. `categorization_rules` still keeps `target_category`, `category_type`, and `category_path` as compatibility/display metadata alongside `category_definition_id`.

## Goals

1. Eliminate duplicated category text columns and rely on `category_definitions` everywhere.
2. Add missing foreign-key constraints so relationships are enforced by SQLite.
3. Keep encrypted/sensitive columns untouched, but ensure every table that references a category or transaction does so by ID.
4. Provide predictable seed data (public, non-sensitive) via `scripts/init_sqlite_db.js`.

## Target Changes (Phase 1)

| Area | Current Situation | Target |
| --- | --- | --- |
| `transactions` | Current schema keeps `category_definition_id` plus denormalized `category_type`; legacy string columns are gone. | Complete for current schema cleanup. |
| `category_budgets` | Current schema references `category_definition_id`. | Complete. |
| `categorization_rules` | Current schema stores target category metadata plus `category_definition_id`. | Decide whether metadata remains as compatibility/display cache or moves fully to joins in a future API cleanup. |
| `category_mapping` | Maps legacy/source category terms to `category_definition_id`. | Keep as an import/resolution compatibility table unless rule resolution is redesigned. |
| `transactions` dependants | Tables like `manual_exclusions`, `transaction_account_links`, `pending_transaction_suggestions` reference transactions by `identifier`/`vendor`. | Keep existing PK but enforce FKs; enrich with category IDs if necessary. |
| Indexing | Many indexes on text columns that will go away. | Rebuild indexes on ID columns once schema updated. |

## Execution Plan

### Phase 1 – API / Code Updates *(in progress)*

1. **Introduce helpers** to resolve category labels/paths (`category_definitions` join) so API routes stop reading `parent_category`/`subcategory`.
2. **Update data writes** (`scrape`, `categorize_transaction`, analytics upserts) to rely on `category_definition_id` only. *(done for scrape + manual categorisation)*
3. **Budget APIs/UI** now operate on `category_definition_id` (schema + front-end). *(done)*
3. **Adjust Electron** endpoints to consume joined category information rather than raw columns.
4. **Add unit helpers** (e.g. `getCategoryHierarchy(categoryId)`) for reuse across API routes/UI.

### Phase 2 – Schema & Seeds

1. Update `scripts/init_sqlite_db.js` to emit the normalised tables (drop redundant columns, add FKs, rebuild indexes).
2. Seed default categories/actionability/budget templates using IDs.
3. Ensure analytics snapshots can rebuild (document truncation/recompute).
4. Provide new view(s) if the UI still needs denormalised representations (optional).

### Phase 3 – Migration

1. Write a one-off SQL/Node script to:
   - Backfill missing `category_definition_id` (if any).
   - Copy text columns into a temporary mapping table.
   - Drop redundant columns after verification.
   - Apply new constraints (`FOREIGN KEY`, `NOT NULL` where appropriate).
2. Current `dist/shekelsync.sqlite` is already migrated for `transactions`. For older databases, write a one-off migration and validate counts against a backup.

### Phase 4 – Clean-up & Verification

1. Remove deprecated code paths once the new schema is in place.
2. Update documentation / README with new init instructions.
3. Add regression checks (e.g. API smoke tests querying categories, budgets, analytics).

## Open Questions / Follow-ups

- Should we keep fallback strings in `category_mapping` for manual categorisation, or rely purely on definitions + translations?
- Are there external integrations (e.g. CSV export) that still expect plain text columns? If so, implement view-based projections instead of keeping duplicated columns.
- Spec for investment categories: align with `category_definitions` or maintain dedicated taxonomy?

---

**Next action:** If further cleanup is desired, focus on whether `categorization_rules` should keep its display/cache metadata or derive all labels from `category_definitions` joins. 
