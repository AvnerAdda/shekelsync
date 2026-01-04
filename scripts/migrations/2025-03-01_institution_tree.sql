-- Build hierarchical institution_nodes table and retire the flat financial_institutions table.
-- Moves existing data into the tree, updates foreign keys, and keeps a compatibility view.

BEGIN;

-- 1) Core table for the hierarchy
CREATE TABLE IF NOT EXISTS institution_nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id INTEGER,
  vendor_code TEXT UNIQUE,
  node_type TEXT NOT NULL CHECK (node_type IN ('root','group','institution')),
  institution_type TEXT,
  category TEXT,
  subcategory TEXT,
  display_name_he TEXT NOT NULL,
  display_name_en TEXT NOT NULL,
  is_scrapable INTEGER NOT NULL DEFAULT 0 CHECK (is_scrapable IN (0,1)),
  logo_url TEXT,
  scraper_company_id TEXT,
  credential_fields TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  display_order INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  hierarchy_path TEXT,
  depth_level INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK ((node_type = 'root' AND parent_id IS NULL) OR (node_type != 'root' AND parent_id IS NOT NULL)),
  CHECK ((node_type = 'institution' AND vendor_code IS NOT NULL) OR (node_type != 'institution' AND vendor_code IS NULL)),
  FOREIGN KEY (parent_id) REFERENCES institution_nodes(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_institution_nodes_vendor_code ON institution_nodes (vendor_code);
CREATE INDEX IF NOT EXISTS idx_institution_nodes_parent ON institution_nodes (parent_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_institution_nodes_path ON institution_nodes (hierarchy_path);
CREATE INDEX IF NOT EXISTS idx_institution_nodes_type ON institution_nodes (node_type);
CREATE INDEX IF NOT EXISTS idx_institution_nodes_category ON institution_nodes (category);
CREATE INDEX IF NOT EXISTS idx_institution_nodes_active ON institution_nodes (is_active);
CREATE INDEX IF NOT EXISTS idx_institution_nodes_scrapable ON institution_nodes (is_scrapable);

-- 2) Seed roots and groups with fixed ids to avoid collisions when copying legacy ids into leaves
INSERT OR IGNORE INTO institution_nodes (
  id, parent_id, vendor_code, node_type, institution_type, category, subcategory,
  display_name_he, display_name_en, is_scrapable, is_active, display_order, notes, hierarchy_path, depth_level
) VALUES
  (100001, NULL, NULL, 'root', 'bank', 'banking', NULL, 'בנקים', 'Banks', 0, 1, 10, NULL, '/bank', 0),
  (100002, NULL, NULL, 'root', 'credit_card', 'banking', NULL, 'כרטיסי אשראי', 'Credit Cards', 0, 1, 20, NULL, '/credit_card', 0),
  (100003, NULL, NULL, 'root', 'investment', 'investments', NULL, 'השקעות', 'Investments', 0, 1, 30, NULL, '/investment', 0),
  (100004, NULL, NULL, 'root', 'insurance', 'insurance', NULL, 'ביטוח', 'Insurance', 0, 1, 40, NULL, '/insurance', 0),
  -- Investment groups (under investment root)
  (100010, 100003, NULL, 'group', 'investment', 'investments', 'liquid', 'השקעות נזילות', 'Liquid Investments', 0, 1, 31, NULL, '/investment/liquid', 1),
  (100011, 100010, NULL, 'group', 'broker', 'brokerage', 'brokerage', 'ברוקראז׳', 'Brokerage', 0, 1, 32, NULL, '/investment/liquid/brokerage', 2),
  (100012, 100010, NULL, 'group', 'crypto', 'crypto', 'crypto', 'קריפטו', 'Crypto', 0, 1, 33, NULL, '/investment/liquid/crypto', 2),
  (100013, 100010, NULL, 'group', 'investment', 'investments', 'cash', 'מזומן ופיקדונות', 'Cash & Deposits', 0, 1, 34, NULL, '/investment/liquid/cash', 2),
  (100020, 100003, NULL, 'group', 'investment', 'investments', 'long_term', 'חיסכון ארוך טווח', 'Long-Term Savings', 0, 1, 35, NULL, '/investment/long_term', 1),
  (100021, 100020, NULL, 'group', 'investment', 'investments', 'pension', 'פנסיה', 'Pension', 0, 1, 36, NULL, '/investment/long_term/pension', 2),
  (100022, 100020, NULL, 'group', 'investment', 'investments', 'provident', 'גמל / השתלמות', 'Provident / Study Fund', 0, 1, 37, NULL, '/investment/long_term/provident', 2),
  (100023, 100020, NULL, 'group', 'investment', 'investments', 'other', 'השקעות אחרות', 'Other Long-Term', 0, 1, 38, NULL, '/investment/long_term/other', 2);

-- 3) Insert leaves using legacy financial_institutions data, mapping each vendor to a parent node
WITH leaf_map AS (
  SELECT
    fi.vendor_code,
    CASE
      WHEN fi.institution_type = 'bank' THEN 'bank'
      WHEN fi.institution_type = 'credit_card' THEN 'credit_card'
      WHEN fi.institution_type = 'insurance' THEN 'insurance'
      WHEN fi.institution_type = 'broker' THEN 'investment_liquid_brokerage'
      WHEN fi.institution_type = 'crypto' THEN 'investment_liquid_crypto'
      WHEN fi.institution_type = 'investment' AND fi.subcategory = 'cash' THEN 'investment_liquid_cash'
      WHEN fi.institution_type = 'investment' AND fi.subcategory = 'pension' THEN 'investment_long_term_pension'
      WHEN fi.institution_type = 'investment' AND fi.subcategory = 'provident' THEN 'investment_long_term_provident'
      ELSE 'investment_long_term_other'
    END AS parent_key,
    CASE
      WHEN fi.institution_type = 'bank' THEN '/bank/' || fi.vendor_code
      WHEN fi.institution_type = 'credit_card' THEN '/credit_card/' || fi.vendor_code
      WHEN fi.institution_type = 'insurance' THEN '/insurance/' || fi.vendor_code
      WHEN fi.institution_type = 'broker' THEN '/investment/liquid/brokerage/' || fi.vendor_code
      WHEN fi.institution_type = 'crypto' THEN '/investment/liquid/crypto/' || fi.vendor_code
      WHEN fi.institution_type = 'investment' AND fi.subcategory = 'cash' THEN '/investment/liquid/cash/' || fi.vendor_code
      WHEN fi.institution_type = 'investment' AND fi.subcategory = 'pension' THEN '/investment/long_term/pension/' || fi.vendor_code
      WHEN fi.institution_type = 'investment' AND fi.subcategory = 'provident' THEN '/investment/long_term/provident/' || fi.vendor_code
      ELSE '/investment/long_term/other/' || fi.vendor_code
    END AS hierarchy_path,
    CASE
      WHEN fi.institution_type IN ('bank','credit_card','insurance') THEN 1
      WHEN fi.institution_type = 'broker' THEN 3
      WHEN fi.institution_type = 'crypto' THEN 3
      WHEN fi.institution_type = 'investment' AND fi.subcategory = 'cash' THEN 3
      WHEN fi.institution_type = 'investment' AND fi.subcategory IN ('pension','provident') THEN 3
      ELSE 3
    END AS depth_level
  FROM financial_institutions fi
),
parent_map AS (
  SELECT 'bank' AS key, id, hierarchy_path FROM institution_nodes WHERE hierarchy_path = '/bank'
  UNION ALL SELECT 'credit_card', id, hierarchy_path FROM institution_nodes WHERE hierarchy_path = '/credit_card'
  UNION ALL SELECT 'insurance', id, hierarchy_path FROM institution_nodes WHERE hierarchy_path = '/insurance'
  UNION ALL SELECT 'investment_liquid_brokerage', id, hierarchy_path FROM institution_nodes WHERE hierarchy_path = '/investment/liquid/brokerage'
  UNION ALL SELECT 'investment_liquid_crypto', id, hierarchy_path FROM institution_nodes WHERE hierarchy_path = '/investment/liquid/crypto'
  UNION ALL SELECT 'investment_liquid_cash', id, hierarchy_path FROM institution_nodes WHERE hierarchy_path = '/investment/liquid/cash'
  UNION ALL SELECT 'investment_long_term_pension', id, hierarchy_path FROM institution_nodes WHERE hierarchy_path = '/investment/long_term/pension'
  UNION ALL SELECT 'investment_long_term_provident', id, hierarchy_path FROM institution_nodes WHERE hierarchy_path = '/investment/long_term/provident'
  UNION ALL SELECT 'investment_long_term_other', id, hierarchy_path FROM institution_nodes WHERE hierarchy_path = '/investment/long_term/other'
)
INSERT OR IGNORE INTO institution_nodes (
  id, parent_id, vendor_code, node_type, institution_type, category, subcategory,
  display_name_he, display_name_en, is_scrapable, logo_url, scraper_company_id,
  credential_fields, is_active, display_order, notes, hierarchy_path, depth_level,
  created_at, updated_at
)
SELECT
  fi.id,
  pm.id AS parent_id,
  fi.vendor_code,
  'institution',
  fi.institution_type,
  fi.category,
  fi.subcategory,
  fi.display_name_he,
  fi.display_name_en,
  fi.is_scrapable,
  fi.logo_url,
  fi.scraper_company_id,
  fi.credential_fields,
  fi.is_active,
  fi.display_order,
  fi.notes,
  lm.hierarchy_path,
  lm.depth_level,
  fi.created_at,
  fi.updated_at
FROM financial_institutions fi
JOIN leaf_map lm ON fi.vendor_code = lm.vendor_code
JOIN parent_map pm ON lm.parent_key = pm.key
WHERE NOT EXISTS (SELECT 1 FROM institution_nodes n WHERE n.vendor_code = fi.vendor_code);

-- 4) Rebuild vendor_credentials with FK pointing to institution_nodes
CREATE TABLE vendor_credentials_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  id_number TEXT,
  username TEXT,
  vendor TEXT NOT NULL,
  password TEXT,
  card6_digits TEXT,
  nickname TEXT,
  bank_account_number TEXT,
  identification_code TEXT,
  current_balance REAL,
  balance_updated_at TEXT,
  last_scrape_success TEXT,
  last_scrape_attempt TEXT,
  last_scrape_status TEXT NOT NULL DEFAULT 'never',
  institution_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(id_number, username, vendor),
  FOREIGN KEY (institution_id) REFERENCES institution_nodes(id) ON DELETE SET NULL
);

INSERT INTO vendor_credentials_new (
  id, id_number, username, vendor, password, card6_digits, nickname, bank_account_number,
  identification_code, current_balance, balance_updated_at, last_scrape_success,
  last_scrape_attempt, last_scrape_status, institution_id, created_at, updated_at
)
SELECT
  id, id_number, username, vendor, password, card6_digits, nickname, bank_account_number,
  identification_code, current_balance, balance_updated_at, last_scrape_success,
  last_scrape_attempt, last_scrape_status, institution_id, created_at, updated_at
FROM vendor_credentials;

DROP TABLE vendor_credentials;
ALTER TABLE vendor_credentials_new RENAME TO vendor_credentials;

-- 5) Rebuild investment_accounts with FK pointing to institution_nodes
CREATE TABLE investment_accounts_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_name TEXT NOT NULL,
  account_type TEXT NOT NULL,
  institution TEXT,
  account_number TEXT,
  currency TEXT NOT NULL DEFAULT 'ILS',
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  notes TEXT,
  institution_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  is_liquid INTEGER,
  investment_category TEXT,
  FOREIGN KEY (institution_id) REFERENCES institution_nodes(id) ON DELETE SET NULL
);

INSERT INTO investment_accounts_new (
  id, account_name, account_type, institution, account_number, currency,
  is_active, notes, institution_id, created_at, updated_at, is_liquid, investment_category
)
SELECT
  id, account_name, account_type, institution, account_number, currency,
  is_active, notes, institution_id, created_at, updated_at, is_liquid, investment_category
FROM investment_accounts;

DROP TABLE investment_accounts;
ALTER TABLE investment_accounts_new RENAME TO investment_accounts;

-- 6) Retire the legacy table and replace with a compatibility view over leaves
DROP TABLE IF EXISTS financial_institutions;

CREATE VIEW financial_institutions AS
SELECT
  id,
  vendor_code,
  institution_type,
  display_name_he,
  display_name_en,
  category,
  subcategory,
  is_scrapable,
  logo_url,
  scraper_company_id,
  credential_fields,
  is_active,
  display_order,
  notes,
  created_at,
  updated_at
FROM institution_nodes
WHERE node_type = 'institution';

COMMIT;
