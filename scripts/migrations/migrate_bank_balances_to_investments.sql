-- Migration: Move bank balances from vendor_credentials to investment holdings
-- Date: 2025-01-12
-- Description: Migrates existing bank balances to investment_holdings system
--              and removes balance columns from vendor_credentials table

BEGIN TRANSACTION;

-- Step 1: Create investment accounts for all existing bank credentials with balances
-- (This will be done via application code to properly set up relationships)

-- Step 2: Remove balance columns from vendor_credentials
-- Note: We keep the columns temporarily during migration, they will be dropped
-- after confirming data migration is successful

-- Create a temporary flag to track migration status
ALTER TABLE vendor_credentials ADD COLUMN IF NOT EXISTS balance_migrated INTEGER DEFAULT 0;

-- The actual column drops will be done in a separate migration after verification:
-- ALTER TABLE vendor_credentials DROP COLUMN IF EXISTS current_balance;
-- ALTER TABLE vendor_credentials DROP COLUMN IF EXISTS balance_updated_at;

COMMIT;

-- Post-migration verification queries:
-- 1. Check investment accounts created:
--    SELECT COUNT(*) FROM investment_accounts WHERE account_type = 'bank_balance';
--
-- 2. Check holdings created:
--    SELECT ia.account_name, ih.current_value, ih.as_of_date
--    FROM investment_holdings ih
--    JOIN investment_accounts ia ON ih.account_id = ia.id
--    WHERE ia.account_type = 'bank_balance'
--    ORDER BY ih.as_of_date DESC;
--
-- 3. Verify no data loss:
--    SELECT vc.vendor, vc.nickname, vc.current_balance,
--           ia.id as investment_account_id, ih.current_value
--    FROM vendor_credentials vc
--    LEFT JOIN investment_accounts ia ON ia.account_type = 'bank_balance'
--      AND ia.notes LIKE '%credential_id:' || vc.id || '%'
--    LEFT JOIN investment_holdings ih ON ih.account_id = ia.id
--    WHERE vc.current_balance IS NOT NULL
--    ORDER BY vc.id;
