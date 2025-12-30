-- Migration: Remove unused budget_alerts table
-- This table was never read by the application code. We drop it to reduce schema bloat.

DROP TABLE IF EXISTS budget_alerts;
