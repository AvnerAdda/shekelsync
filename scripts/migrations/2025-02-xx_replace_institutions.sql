-- Migration: Replace generic investment institutions with vendor-specific entries
-- Adds granular pension/provident entries, a bank deposit placeholder, and an "investment_unknown" fallback.
-- Re-maps existing investment_accounts and vendor_credentials pointing to removed generic institutions to the fallback.

PRAGMA foreign_keys = OFF;

-- Insert new granular institutions if missing
INSERT OR IGNORE INTO financial_institutions (
  vendor_code, institution_type, display_name_he, display_name_en, category, subcategory, is_scrapable, display_order, is_active
) VALUES
  ('clal_pension', 'investment', 'כלל פנסיה', 'Clal Pension', 'investments', 'pension', 0, 300, 1),
  ('migdal_pension', 'investment', 'מגדל פנסיה', 'Migdal Pension', 'investments', 'pension', 0, 310, 1),
  ('menora_pension', 'investment', 'מנורה פנסיה', 'Menora Pension', 'investments', 'pension', 0, 320, 1),
  ('harel_pension', 'investment', 'הראל פנסיה', 'Harel Pension', 'investments', 'pension', 0, 330, 1),
  ('phoenix_pension', 'investment', 'פניקס פנסיה', 'Phoenix Pension', 'investments', 'pension', 0, 340, 1),
  ('ayalon_pension', 'investment', 'איילון פנסיה', 'Ayalon Pension', 'investments', 'pension', 0, 350, 1),
  ('meitav_pension', 'investment', 'מיטב פנסיה', 'Meitav Pension', 'investments', 'pension', 0, 360, 1),
  ('altshuler_pension', 'investment', 'אלטשולר שחם פנסיה', 'Altshuler Pension', 'investments', 'pension', 0, 370, 1),
  ('psagot_pension', 'investment', 'פסגות פנסיה', 'Psagot Pension', 'investments', 'pension', 0, 380, 1),
  ('more_pension', 'investment', 'מור פנסיה', 'More Pension', 'investments', 'pension', 0, 390, 1),
  ('clal_provident', 'investment', 'כלל קופת גמל / השתלמות', 'Clal Provident / Study Fund', 'investments', 'provident', 0, 400, 1),
  ('migdal_provident', 'investment', 'מגדל קופת גמל / השתלמות', 'Migdal Provident / Study Fund', 'investments', 'provident', 0, 410, 1),
  ('menora_provident', 'investment', 'מנורה קופת גמל / השתלמות', 'Menora Provident / Study Fund', 'investments', 'provident', 0, 420, 1),
  ('harel_provident', 'investment', 'הראל קופת גמל / השתלמות', 'Harel Provident / Study Fund', 'investments', 'provident', 0, 430, 1),
  ('phoenix_provident', 'investment', 'פניקס קופת גמל / השתלמות', 'Phoenix Provident / Study Fund', 'investments', 'provident', 0, 440, 1),
  ('ayalon_provident', 'investment', 'איילון קופת גמל / השתלמות', 'Ayalon Provident / Study Fund', 'investments', 'provident', 0, 450, 1),
  ('meitav_provident', 'investment', 'מיטב קופת גמל / השתלמות', 'Meitav Provident / Study Fund', 'investments', 'provident', 0, 460, 1),
  ('altshuler_provident', 'investment', 'אלטשולר שחם קופת גמל / השתלמות', 'Altshuler Provident / Study Fund', 'investments', 'provident', 0, 470, 1),
  ('psagot_provident', 'investment', 'פסגות קופת גמל / השתלמות', 'Psagot Provident / Study Fund', 'investments', 'provident', 0, 480, 1),
  ('more_provident', 'investment', 'מור קופת גמל / השתלמות', 'More Provident / Study Fund', 'investments', 'provident', 0, 490, 1),
  ('bank_deposit', 'investment', 'פיקדון בנקאי', 'Bank Deposit', 'investments', 'cash', 0, 500, 1),
  ('investment_unknown', 'investment', 'השקעה לא מזוהה', 'Unknown Investment', 'investments', 'other', 0, 510, 1);

-- Ensure fallback exists and capture its id
WITH fallback AS (
  SELECT id FROM financial_institutions WHERE vendor_code = 'investment_unknown'
)
UPDATE investment_accounts
SET institution_id = (SELECT id FROM fallback)
WHERE institution_id IN (
  SELECT id FROM financial_institutions
  WHERE vendor_code IN (
    'pension','provident','study_fund','savings','brokerage','crypto',
    'mutual_fund','bonds','real_estate','bank_balance','cash',
    'foreign_bank','foreign_investment','other_investment'
  )
);

WITH fallback AS (
  SELECT id FROM financial_institutions WHERE vendor_code = 'investment_unknown'
)
UPDATE vendor_credentials
SET institution_id = (SELECT id FROM fallback)
WHERE institution_id IN (
  SELECT id FROM financial_institutions
  WHERE vendor_code IN (
    'pension','provident','study_fund','savings','brokerage','crypto',
    'mutual_fund','bonds','real_estate','bank_balance','cash',
    'foreign_bank','foreign_investment','other_investment'
  )
);

-- Drop legacy generic rows
DELETE FROM financial_institutions
WHERE vendor_code IN (
  'pension','provident','study_fund','savings','brokerage','crypto',
  'mutual_fund','bonds','real_estate','bank_balance','cash',
  'foreign_bank','foreign_investment','other_investment'
);

PRAGMA foreign_keys = ON;
