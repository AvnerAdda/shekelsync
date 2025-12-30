-- Migration: Add additional retail brokers
-- Inserts Interactive Brokers, eToro, and Plus500 if they are missing.

INSERT OR IGNORE INTO financial_institutions (
  vendor_code, institution_type, display_name_he, display_name_en, category, subcategory, is_scrapable, display_order, is_active
) VALUES
  ('interactive_brokers', 'broker', 'אינטראקטיב ברוקרס', 'Interactive Brokers', 'brokerage', NULL, 0, 670, 1),
  ('etoro', 'broker', 'eToro', 'eToro', 'brokerage', NULL, 0, 680, 1),
  ('plus500', 'broker', 'Plus500', 'Plus500', 'brokerage', NULL, 0, 690, 1);

