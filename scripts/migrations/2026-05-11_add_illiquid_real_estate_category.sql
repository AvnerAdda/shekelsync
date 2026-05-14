-- Migration: Add illiquid real estate investment category
-- Description: Adds generic real estate institution nodes and reclassifies real estate accounts as illiquid assets.

BEGIN;

INSERT OR IGNORE INTO institution_nodes (
  parent_id, vendor_code, node_type, institution_type, category, subcategory,
  display_name_he, display_name_en, is_scrapable, is_active, display_order,
  hierarchy_path, depth_level
)
SELECT
  root.id, NULL, 'group', 'investment', 'investments', 'illiquid',
  'נכסים לא נזילים', 'Illiquid Assets', 0, 1, 35,
  '/investment/illiquid', 1
FROM institution_nodes root
WHERE root.hierarchy_path = '/investment';

INSERT OR IGNORE INTO institution_nodes (
  parent_id, vendor_code, node_type, institution_type, category, subcategory,
  display_name_he, display_name_en, is_scrapable, is_active, display_order,
  hierarchy_path, depth_level
)
SELECT
  illiquid.id, NULL, 'group', 'investment', 'investments', 'real_estate',
  'נדל"ן', 'Real Estate', 0, 1, 36,
  '/investment/illiquid/real_estate', 2
FROM institution_nodes illiquid
WHERE illiquid.hierarchy_path = '/investment/illiquid';

INSERT OR IGNORE INTO institution_nodes (
  parent_id, vendor_code, node_type, institution_type, category, subcategory,
  display_name_he, display_name_en, is_scrapable, is_active, display_order,
  notes, hierarchy_path, depth_level
)
SELECT
  real_estate_group.id, 'real_estate', 'institution', 'investment', 'investments', 'real_estate',
  'נדל"ן', 'Real Estate', 0, 1, 510,
  'Manual real estate asset tracking',
  '/investment/illiquid/real_estate/real_estate', 3
FROM institution_nodes real_estate_group
WHERE real_estate_group.hierarchy_path = '/investment/illiquid/real_estate';

UPDATE institution_nodes
SET parent_id = (
      SELECT parent.id
      FROM institution_nodes parent
      WHERE parent.hierarchy_path = '/investment/illiquid/real_estate'
      LIMIT 1
    ),
    institution_type = 'investment',
    category = 'investments',
    subcategory = 'real_estate',
    display_name_he = 'נדל"ן',
    display_name_en = 'Real Estate',
    is_scrapable = 0,
    is_active = 1,
    display_order = 510,
    hierarchy_path = '/investment/illiquid/real_estate/real_estate',
    depth_level = 3
WHERE vendor_code = 'real_estate'
  AND node_type = 'institution'
  AND EXISTS (
    SELECT 1
    FROM institution_nodes parent
    WHERE parent.hierarchy_path = '/investment/illiquid/real_estate'
  );

UPDATE investment_accounts
SET is_liquid = 0,
    investment_category = 'illiquid',
    updated_at = datetime('now')
WHERE account_type = 'real_estate'
   OR investment_category = 'real_estate';

UPDATE investment_accounts
SET institution_id = (
      SELECT id
      FROM institution_nodes
      WHERE vendor_code = 'real_estate'
        AND node_type = 'institution'
      LIMIT 1
    ),
    updated_at = datetime('now')
WHERE account_type = 'real_estate'
  AND institution_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM institution_nodes
    WHERE vendor_code = 'real_estate'
      AND node_type = 'institution'
  );

COMMIT;
