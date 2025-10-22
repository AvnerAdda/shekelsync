# Category Schema Migration Guide

## Overview

This document describes the migration from legacy string-based category columns to a normalized `category_definitions` schema with foreign key relationships.

## Migration Timeline

- **Phase 1 (Completed):** Backend API migration - All `/api/*` endpoints now use `category_definition_id`
- **Phase 2 (Partially Complete):** Frontend component migration - Main dashboard components updated
- **Phase 3 (Ready):** Database schema cleanup - Script available to deprecate/drop legacy columns

## Architecture Changes

### Before (Legacy Schema)
```sql
-- transactions table
CREATE TABLE transactions (
  ...
  category TEXT,              -- String: 'Food', 'Transport', etc.
  parent_category TEXT,       -- String: 'Food', 'Shopping', etc.
  subcategory TEXT,           -- String: 'Groceries', 'Restaurants', etc.
  ...
);
```

### After (Normalized Schema)
```sql
-- category_definitions table
CREATE TABLE category_definitions (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  name_en TEXT,
  category_type TEXT NOT NULL,  -- 'expense', 'income', 'investment'
  parent_id INTEGER,             -- Self-referencing FK for hierarchy
  ...
  FOREIGN KEY (parent_id) REFERENCES category_definitions(id)
);

-- transactions table
CREATE TABLE transactions (
  ...
  category_definition_id INTEGER,
  FOREIGN KEY (category_definition_id) REFERENCES category_definitions(id)
);
```

## Benefits

1. **Data Integrity:** Foreign key constraints prevent invalid categories
2. **Hierarchy Support:** Parent/child relationships properly modeled
3. **Internationalization:** Built-in support for Hebrew (`name`) and English (`name_en`)
4. **Type Safety:** Categories typed as `expense`, `income`, or `investment`
5. **Maintainability:** Single source of truth for category definitions
6. **Performance:** Proper indexing on numeric IDs vs string matching

## API Changes

### Backend Response Format Changes

#### Old Format
```json
{
  "category": "Food",
  "parent_category": "Expenses",
  "subcategory": "Restaurants"
}
```

#### New Format
```json
{
  "category_definition_id": 42,
  "category_name": "מסעדות",
  "category_name_en": "Restaurants",
  "parent_name": "אוכל",
  "parent_name_en": "Food"
}
```

### Query Pattern Changes

#### Old Pattern (String Matching)
```javascript
const result = await db.query(`
  SELECT category, SUM(price) as total
  FROM transactions
  WHERE parent_category = 'Food'
  GROUP BY category
`);
```

#### New Pattern (ID-based with JOINs)
```javascript
const result = await db.query(`
  SELECT
    cd.id as category_definition_id,
    cd.name as category_name,
    parent.name as parent_name,
    SUM(price) as total
  FROM transactions t
  JOIN category_definitions cd ON t.category_definition_id = cd.id
  LEFT JOIN category_definitions parent ON cd.parent_id = parent.id
  WHERE cd.parent_id = $1  -- or use recursive CTE for full tree
  GROUP BY cd.id, cd.name, parent.name
`, [parentCategoryId]);
```

#### Recursive Category Queries (With Children)
```javascript
// Get all transactions in a category AND its subcategories
const result = await db.query(`
  WITH RECURSIVE category_tree AS (
    SELECT id FROM category_definitions WHERE id = $1
    UNION ALL
    SELECT cd.id FROM category_definitions cd
    JOIN category_tree ct ON cd.parent_id = ct.id
  )
  SELECT * FROM transactions t
  WHERE t.category_definition_id IN (SELECT id FROM category_tree)
`, [categoryId]);
```

## Frontend Migration Guide

### TypeScript Interface Changes

#### Before
```typescript
interface Transaction {
  category?: string;
  parent_category?: string;
  subcategory?: string;
}
```

#### After
```typescript
interface Transaction {
  category_definition_id?: number;
  category_name?: string;
  category_name_en?: string | null;
  parent_category_name?: string | null;
  parent_category_name_en?: string | null;
  // Legacy fields (deprecated, for backward compatibility)
  legacy_category?: string;
  legacy_parent_category?: string;
}
```

### Display Helper Pattern

For backward compatibility during transition, use a display helper:

```typescript
const getDisplayCategory = (transaction: Transaction) =>
  transaction.category_name ||
  transaction.legacy_category ||
  'Uncategorized';
```

### Category Dropdown Migration

#### Before
```typescript
<Select value={category}>
  {categories.map(cat => (
    <MenuItem value={cat}>{cat}</MenuItem>
  ))}
</Select>
```

#### After
```typescript
interface CategoryOption {
  id: number;
  name: string;
  parentName?: string | null;
  label: string; // Formatted display: "Parent › Child"
}

<Select value={categoryDefinitionId}>
  {categories.map(cat => (
    <MenuItem value={cat.id}>{cat.label}</MenuItem>
  ))}
</Select>
```

## Migration Checklist

### ✅ Backend APIs (Complete)
- [x] All `/api/analytics/*` endpoints
- [x] All `/api/budgets/*` endpoints
- [x] `/api/transactions/*` endpoints
- [x] `/api/categorize_transaction.js`
- [x] `/api/investments/check-existing.js`
- [x] `/api/chat.js`

### ✅ Frontend Components (Mostly Complete)
- [x] CategoryDashboard (fully migrated)
- [x] BudgetsPage (fully migrated)
- [x] ManualModal, ManualResolutionPanel, PatternSuggestionsPanel
- [x] SmartNotifications, SummaryCards
- [ ] CostBreakdownPanel (needs update)
- [ ] HomePage (partially needs update - investment filtering)
- [ ] AccountsModal (needs update)
- [ ] DuplicateManagementModal (needs update)
- [ ] AnalysisPage/ActionabilitySetupModal (needs update)

### Database Schema
- [x] Migration script created (`scripts/deprecate_legacy_category_columns.js`)
- [ ] Run migration script (analyze mode): `node scripts/deprecate_legacy_category_columns.js`
- [ ] Verify all legacy columns are empty
- [ ] Run migration script (drop mode): `node scripts/deprecate_legacy_category_columns.js --drop`

## Running the Database Migration

### Step 1: Analyze Current State (Safe)
```bash
node scripts/deprecate_legacy_category_columns.js
```

This will show which columns exist and how many rows have data.

### Step 2: Verify No Data in Legacy Columns
The output should show all legacy columns have 0 non-null rows. If not, there's still data migration needed.

### Step 3: Drop Legacy Columns (Creates Backup Automatically)
```bash
node scripts/deprecate_legacy_category_columns.js --drop
```

A backup will be created at `dist/clarify.sqlite.bak-YYYYMMDDHHMMSS` before any changes.

### Step 4: Test Application
After dropping columns:
1. Start the app: `cd app && npm run dev`
2. Test all major features:
   - Category dashboard
   - Budget creation/editing
   - Transaction categorization
   - Analytics pages
   - Manual transaction entry

### Rollback (If Needed)
```bash
# If something breaks, restore from backup:
cp dist/clarify.sqlite.bak-YYYYMMDDHHMMSS dist/clarify.sqlite
```

## Breaking Changes

### API Response Fields

The following fields are no longer returned by APIs (replaced with normalized equivalents):

| Old Field | New Field(s) |
|-----------|--------------|
| `category` | `category_name` + `category_definition_id` |
| `parentCategory` | `parent_name` + `parent_category_definition_id` |
| `subcategory` | `category_name` (when it's a child) |
| `parent_category` | `parent_name` |

### Frontend Props

Components expecting string categories now receive numeric IDs:

```typescript
// Before
interface Props {
  category: string;
}

// After
interface Props {
  categoryDefinitionId: number;
  categoryName: string;
}
```

## Backward Compatibility

During the transition period, some APIs may return **both** old and new fields:

```json
{
  "category_definition_id": 42,
  "category_name": "מסעדות",
  "legacy_category": "Restaurants"  // For backward compatibility
}
```

This allows gradual frontend migration. Once all frontend components are updated, legacy fields can be removed.

## Testing

### Unit Tests
```bash
# Test backend APIs
npm test -- --testPathPattern=api

# Test frontend components
npm test -- --testPathPattern=components
```

### Manual Testing Scenarios
1. **Category Dashboard:**
   - View expense breakdown by category
   - Drill down into subcategories
   - Verify amounts match database

2. **Budget Management:**
   - Create new budget for a category
   - Edit existing budget
   - View budget usage

3. **Transaction Categorization:**
   - Manually categorize a transaction
   - Apply categorization rules
   - Verify auto-categorization

4. **Analytics:**
   - View spending trends
   - Category comparison
   - Monthly breakdown

## Troubleshooting

### Issue: Frontend Shows "undefined" for Categories
**Cause:** Component still accessing `.category` instead of `.category_name`

**Fix:** Update component to use new field names:
```typescript
// Before
<div>{transaction.category}</div>

// After
<div>{transaction.category_name || transaction.legacy_category}</div>
```

### Issue: API Returns 500 Error After Migration
**Cause:** Query still referencing dropped columns

**Fix:** Check API endpoint code - it should JOIN `category_definitions` table

### Issue: Category Dropdown Is Empty
**Cause:** Frontend fetching from old endpoint that returned string array

**Fix:** Update to use `/api/categories/hierarchy` endpoint which returns full category objects

## Support

For questions or issues with the migration:
1. Check this guide first
2. Review git diff: `git diff app/pages/api app/components`
3. Check migration script logs
4. Restore from backup if needed

## Next Steps

After completing the migration:
1. ✅ Remove legacy field references from codebase
2. ✅ Update API documentation
3. ✅ Remove backward compatibility code
4. ✅ Add indexes on `category_definition_id` columns (already done)
5. ✅ Consider adding database constraints (NOT NULL where appropriate)

## References

- Migration script: `scripts/deprecate_legacy_category_columns.js`
- Schema init script: `scripts/init_sqlite_db.js`
- Category helpers: `app/lib/category-helpers.js`
- TypeScript types: `app/components/CategoryDashboard/types/index.ts`
