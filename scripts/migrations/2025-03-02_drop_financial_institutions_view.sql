-- Remove the legacy financial_institutions compatibility view now that all code reads from institution_nodes.

BEGIN;

DROP VIEW IF EXISTS financial_institutions;

COMMIT;
