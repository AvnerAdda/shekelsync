-- Ensure "Transfers to Investments" is treated as an expense category.
-- This migration is for existing databases only.

PRAGMA foreign_keys = ON;
BEGIN;

-- Normalize the canonical row to expense and attach to Bank Settlements when available.
WITH canonical AS (
  SELECT id
  FROM category_definitions
  WHERE LOWER(COALESCE(name, '')) IN ('העברות להשקעות', 'העברה להשקעה')
     OR LOWER(COALESCE(name_en, '')) IN ('transfers to investments', 'transfer to investment')
  ORDER BY CASE WHEN category_type = 'expense' THEN 0 ELSE 1 END, id
  LIMIT 1
),
bank_parent AS (
  SELECT id
  FROM category_definitions
  WHERE category_type = 'expense'
    AND (
      LOWER(COALESCE(name, '')) = LOWER('תשלומי בנק')
      OR LOWER(COALESCE(name_en, '')) = LOWER('Bank Settlements')
    )
  ORDER BY id
  LIMIT 1
)
UPDATE category_definitions
SET
  name = 'העברות להשקעות',
  name_en = 'Transfers to Investments',
  category_type = 'expense',
  parent_id = COALESCE((SELECT id FROM bank_parent), parent_id),
  is_active = 1,
  updated_at = datetime('now')
WHERE id = (SELECT id FROM canonical);

-- Move references from duplicate transfer-to-investments rows to the canonical row.
WITH canonical AS (
  SELECT id
  FROM category_definitions
  WHERE LOWER(COALESCE(name, '')) IN ('העברות להשקעות', 'העברה להשקעה')
     OR LOWER(COALESCE(name_en, '')) IN ('transfers to investments', 'transfer to investment')
  ORDER BY CASE WHEN category_type = 'expense' THEN 0 ELSE 1 END, id
  LIMIT 1
),
duplicates AS (
  SELECT id
  FROM category_definitions
  WHERE (LOWER(COALESCE(name, '')) IN ('העברות להשקעות', 'העברה להשקעה')
      OR LOWER(COALESCE(name_en, '')) IN ('transfers to investments', 'transfer to investment'))
    AND id <> (SELECT id FROM canonical)
)
UPDATE transactions
SET category_definition_id = (SELECT id FROM canonical)
WHERE category_definition_id IN (SELECT id FROM duplicates);

WITH canonical AS (
  SELECT id
  FROM category_definitions
  WHERE LOWER(COALESCE(name, '')) IN ('העברות להשקעות', 'העברה להשקעה')
     OR LOWER(COALESCE(name_en, '')) IN ('transfers to investments', 'transfer to investment')
  ORDER BY CASE WHEN category_type = 'expense' THEN 0 ELSE 1 END, id
  LIMIT 1
),
duplicates AS (
  SELECT id
  FROM category_definitions
  WHERE (LOWER(COALESCE(name, '')) IN ('העברות להשקעות', 'העברה להשקעה')
      OR LOWER(COALESCE(name_en, '')) IN ('transfers to investments', 'transfer to investment'))
    AND id <> (SELECT id FROM canonical)
)
UPDATE category_mapping
SET category_definition_id = (SELECT id FROM canonical)
WHERE category_definition_id IN (SELECT id FROM duplicates);

WITH canonical AS (
  SELECT id
  FROM category_definitions
  WHERE LOWER(COALESCE(name, '')) IN ('העברות להשקעות', 'העברה להשקעה')
     OR LOWER(COALESCE(name_en, '')) IN ('transfers to investments', 'transfer to investment')
  ORDER BY CASE WHEN category_type = 'expense' THEN 0 ELSE 1 END, id
  LIMIT 1
),
duplicates AS (
  SELECT id
  FROM category_definitions
  WHERE (LOWER(COALESCE(name, '')) IN ('העברות להשקעות', 'העברה להשקעה')
      OR LOWER(COALESCE(name_en, '')) IN ('transfers to investments', 'transfer to investment'))
    AND id <> (SELECT id FROM canonical)
)
UPDATE categorization_rules
SET category_definition_id = (SELECT id FROM canonical)
WHERE category_definition_id IN (SELECT id FROM duplicates);

-- Ensure records that reference the canonical row are explicitly expense.
WITH canonical AS (
  SELECT id
  FROM category_definitions
  WHERE LOWER(COALESCE(name, '')) IN ('העברות להשקעות', 'העברה להשקעה')
     OR LOWER(COALESCE(name_en, '')) IN ('transfers to investments', 'transfer to investment')
  ORDER BY CASE WHEN category_type = 'expense' THEN 0 ELSE 1 END, id
  LIMIT 1
)
UPDATE transactions
SET category_type = 'expense'
WHERE category_definition_id = (SELECT id FROM canonical)
  AND COALESCE(category_type, '') <> 'expense';

WITH canonical AS (
  SELECT id
  FROM category_definitions
  WHERE LOWER(COALESCE(name, '')) IN ('העברות להשקעות', 'העברה להשקעה')
     OR LOWER(COALESCE(name_en, '')) IN ('transfers to investments', 'transfer to investment')
  ORDER BY CASE WHEN category_type = 'expense' THEN 0 ELSE 1 END, id
  LIMIT 1
)
UPDATE categorization_rules
SET
  category_type = 'expense',
  updated_at = datetime('now')
WHERE category_definition_id = (SELECT id FROM canonical)
  AND COALESCE(category_type, '') <> 'expense';

-- Remove duplicate rows (for example: legacy "Transfer to Investment" under investment).
WITH canonical AS (
  SELECT id
  FROM category_definitions
  WHERE LOWER(COALESCE(name, '')) IN ('העברות להשקעות', 'העברה להשקעה')
     OR LOWER(COALESCE(name_en, '')) IN ('transfers to investments', 'transfer to investment')
  ORDER BY CASE WHEN category_type = 'expense' THEN 0 ELSE 1 END, id
  LIMIT 1
)
DELETE FROM category_definitions
WHERE (LOWER(COALESCE(name, '')) IN ('העברות להשקעות', 'העברה להשקעה')
    OR LOWER(COALESCE(name_en, '')) IN ('transfers to investments', 'transfer to investment'))
  AND id <> (SELECT id FROM canonical);

COMMIT;
