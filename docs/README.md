# Finance-Israel Documentation

## Quick Links

### Migration Documentation
- **[Migration Complete Summary](./MIGRATION_COMPLETE_SUMMARY.md)** - Start here! Complete overview and next steps
- **[Category Schema Migration Guide](./CATEGORY_SCHEMA_MIGRATION.md)** - Detailed technical guide

### Scripts
- **Database Init:** `../scripts/init_sqlite_db.js`
- **Migrations:** `../scripts/migrations/`

---

## Recent Changes (October 2025)

### Category Schema Normalization ✅ COMPLETE

**Status:** Schema cleanup already applied in current DB snapshot

**What Changed:**
- All backend APIs migrated from string-based categories to normalized `category_definitions` schema
- 15+ frontend components updated to use `category_definition_id`
- Legacy columns removed from `transactions` in current schema
- Comprehensive documentation and testing guides

**Impact:**
- 🚀 Faster queries (numeric IDs vs string matching)
- 🔒 Data integrity (foreign key constraints)
- 🌍 Better internationalization (Hebrew + English names)
- 🎯 Type safety (expense/income/investment types)

**Next Steps:**
1. Read: `MIGRATION_COMPLETE_SUMMARY.md`
2. Verify your local schema with `sqlite3 dist/clarify.sqlite ".schema transactions"`
3. If you have an older database, follow the migration guide to create a one-off migration

---

## Documentation Index

### For Developers

#### Migration & Database
- [Category Schema Migration Guide](./CATEGORY_SCHEMA_MIGRATION.md) - API changes, query patterns, testing
- [Migration Complete Summary](./MIGRATION_COMPLETE_SUMMARY.md) - Status, statistics, next steps

#### Architecture
- [Project README](../README.md) - Project overview, tech stack, architecture patterns
- Category Helpers: `../app/lib/category-helpers.js`
- Category Constants: `../app/lib/category-constants.js`
- SQL Dialect: `../app/lib/sql-dialect.js`

#### TypeScript Types
- Category Types: `../app/components/CategoryDashboard/types/index.ts`
- Interfaces: `CategorySummary`, `Expense`, `CategoryOption`

### For Operations

#### Database Scripts
```bash
# Initialize new SQLite database
node scripts/init_sqlite_db.js

# Run schema migration v2
node scripts/migrate_schema_v2.js

# Deprecate legacy category columns (analyze)
node scripts/deprecate_legacy_category_columns.js

# Deprecate legacy category columns (execute with backup)
node scripts/deprecate_legacy_category_columns.js --drop
```

#### Development
```bash
# Start development server
cd app && npm run dev

# Run tests
npm test

# Run linter
npm run lint

# Build for production
npm run build
```

---

## Database Schema Overview

### Core Tables

#### `category_definitions`
Normalized category hierarchy with internationalization support.

```sql
CREATE TABLE category_definitions (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,              -- Hebrew name
  name_en TEXT,                    -- English name
  category_type TEXT NOT NULL,     -- 'expense', 'income', 'investment'
  parent_id INTEGER,               -- Self-referencing FK
  icon TEXT,
  color TEXT,
  is_active BOOLEAN DEFAULT true,
  FOREIGN KEY (parent_id) REFERENCES category_definitions(id)
);
```

#### `transactions`
All financial transactions (bank, credit card, manual).

```sql
CREATE TABLE transactions (
  identifier TEXT,
  vendor TEXT,
  date TEXT NOT NULL,
  price REAL NOT NULL,              -- Negative for expenses, positive for income
  category_definition_id INTEGER,   -- FK to category_definitions
  category_type TEXT,               -- Denormalized for performance
  account_number TEXT,
  merchant_name TEXT,
  -- ... other fields
  FOREIGN KEY (category_definition_id) REFERENCES category_definitions(id),
  PRIMARY KEY (identifier, vendor)
);
```

#### `categorization_rules`
Pattern-based auto-categorization rules.

```sql
CREATE TABLE categorization_rules (
  id INTEGER PRIMARY KEY,
  name_pattern TEXT NOT NULL,
  category_definition_id INTEGER,   -- FK instead of string
  is_active BOOLEAN DEFAULT true,
  priority INTEGER DEFAULT 0,
  FOREIGN KEY (category_definition_id) REFERENCES category_definitions(id)
);
```

### Indexes
- `idx_transactions_date` - Date range queries
- `idx_transactions_category_def` - Category filtering
- `idx_transactions_vendor` - Vendor lookups
- `idx_transactions_category_type` - Type filtering
- ... and more (see `init_sqlite_db.js`)

---

## API Endpoints

### Category APIs
- `GET /api/categories/hierarchy?type=expense` - Get category tree
- `GET /api/get_all_categories` - Legacy endpoint (still works)

### Transaction APIs
- `GET /api/transactions/bank?month=YYYY-MM` - Bank transactions
- `POST /api/categorize_transaction` - Manual categorization
- `GET /api/category_expenses?categoryId=123` - Expenses by category

### Analytics APIs
- `GET /api/analytics/unified-category` - Unified endpoint (replaces 4 legacy endpoints)
- `GET /api/analytics/enhanced-dashboard` - Dashboard with subcategories
- `GET /api/analytics/breakdown?type=expense` - Breakdown by type
- `GET /api/analytics/category-details?categoryId=123` - Category details
- ... see full list in `CATEGORY_SCHEMA_MIGRATION.md`

### Budget APIs
- `GET /api/budgets` - Get all budgets with usage
- `POST /api/budgets` - Create new budget
- `PUT /api/budgets/:id` - Update budget
- `GET /api/budgets/recommendations` - Smart budget suggestions

---

## Common Tasks

### Adding a New Category

```javascript
// Using the normalized schema
const result = await db.query(`
  INSERT INTO category_definitions (name, name_en, category_type, parent_id)
  VALUES ($1, $2, $3, $4)
  RETURNING id
`, ['מסעדות', 'Restaurants', 'expense', parentCategoryId]);

const newCategoryId = result.rows[0].id;
```

### Querying Transactions by Category (Including Subcategories)

```javascript
const transactions = await db.query(`
  WITH RECURSIVE category_tree AS (
    SELECT id FROM category_definitions WHERE id = $1
    UNION ALL
    SELECT cd.id FROM category_definitions cd
    JOIN category_tree ct ON cd.parent_id = ct.id
  )
  SELECT
    t.*,
    cd.name as category_name,
    parent.name as parent_name
  FROM transactions t
  JOIN category_definitions cd ON t.category_definition_id = cd.id
  LEFT JOIN category_definitions parent ON cd.parent_id = parent.id
  WHERE t.category_definition_id IN (SELECT id FROM category_tree)
  AND t.date >= $2
  ORDER BY t.date DESC
`, [categoryId, startDate]);
```

### Creating a Budget for a Category

```javascript
const budget = await db.query(`
  INSERT INTO budgets (
    category_definition_id,
    period_type,
    budget_limit,
    is_active
  ) VALUES ($1, $2, $3, $4)
  RETURNING *
`, [categoryId, 'monthly', 2000, true]);
```

---

## Migration Status

### ✅ Completed
- Backend API migration (100%)
- Frontend component migration (90%)
- Database migration script
- Documentation
- Type definitions

### 🔄 In Progress
- Final frontend component updates (optional, non-blocking)

### 📋 Next
- Run schema cleanup script
- Remove legacy field references (optional)
- Performance optimization (optional)

---

## Rollback Procedures

### Database Rollback
If issues occur after schema cleanup:

```bash
# List available backups
ls -la dist/*.bak-*

# Restore from backup
cp dist/clarify.sqlite.bak-YYYYMMDDHHMMSS dist/clarify.sqlite

# Restart application
cd app && npm run dev
```

### Code Rollback
```bash
# View recent commits
git log --oneline -10

# Revert to specific commit
git revert <commit-hash>

# Or reset to previous state (loses changes!)
git reset --hard HEAD~1
```

---

## Performance Considerations

### Query Performance
- ✅ Use `category_definition_id` for filtering (indexed)
- ✅ Use JOINs instead of subqueries when possible
- ✅ Use recursive CTEs for hierarchical queries
- ⚠️ Avoid `SELECT *` on transactions table (large table)
- ⚠️ Always include date ranges in queries

### Frontend Performance
- ✅ Fetch categories once, cache in state
- ✅ Use React.memo for expensive components
- ✅ Paginate large transaction lists
- ⚠️ Avoid re-fetching on every render

---

## Testing

### Backend API Tests
```bash
# Test specific endpoint
curl http://localhost:3000/api/categories/hierarchy?type=expense

# Test unified analytics
curl "http://localhost:3000/api/analytics/unified-category?groupBy=category&months=3"

# Test budget creation
curl -X POST http://localhost:3000/api/budgets \
  -H "Content-Type: application/json" \
  -d '{"category_definition_id": 42, "period_type": "monthly", "budget_limit": 2000}'
```

### Frontend Testing
1. Navigate to http://localhost:3000
2. Test Category Dashboard
3. Test Budget creation/editing
4. Test Transaction categorization
5. Test Analytics pages

### Database Testing
```bash
# Connect to SQLite database
sqlite3 dist/clarify.sqlite

# Check category definitions
SELECT * FROM category_definitions WHERE is_active = 1;

# Check transactions with categories
SELECT
  t.date,
  t.name,
  t.price,
  cd.name as category
FROM transactions t
LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
LIMIT 10;
```

---

## Support & Troubleshooting

### Common Issues

**Issue:** Frontend shows "undefined" for categories
**Solution:** Check API response - it should return `category_name`, not `category`

**Issue:** API returns 500 error after migration
**Solution:** Check API code - ensure it JOINs `category_definitions` table

**Issue:** Budget dropdown is empty
**Solution:** Verify `/api/categories/hierarchy` endpoint is working

**Issue:** Database locked error
**Solution:** Close all database connections, restart app

### Getting Help
1. Check `CATEGORY_SCHEMA_MIGRATION.md` for detailed guides
2. Check `MIGRATION_COMPLETE_SUMMARY.md` for status
3. Review git history: `git log --oneline`
4. Check migration script logs
5. Restore from backup if needed

---

## Contributing

When making changes:
1. Update TypeScript interfaces if changing data structures
2. Update API documentation if adding/changing endpoints
3. Run linter: `npm run lint`
4. Test changes locally before committing
5. Update this documentation if needed

---

## License

MIT (see `../LICENSE`)

---

## Contact

Open an issue in the repository.
