# Deprecated API Endpoints

This directory contains endpoints that have been deprecated in favor of consolidated alternatives.

## Deprecated Endpoints

### Category Analytics
- **`category_expenses.js`** → Use `/api/analytics/unified-category` with `includeTransactions=true`
- **`expenses_by_month.js`** → Use `/api/analytics/unified-category` with `groupBy=month`
- **`analytics/breakdown.js`** → Use `/api/analytics/unified-category` with appropriate `type` parameter
- **`analytics/category-details.js`** → Use `/api/analytics/unified-category` with specific category filters

## Migration Guide

### Old: `/api/category_expenses?month=2024-01&category=Food`
### New: `/api/analytics/unified-category?startDate=2024-01-01&endDate=2024-01-31&category=Food&includeTransactions=true`

### Old: `/api/expenses_by_month?month=12&groupByYear=false`
### New: `/api/analytics/unified-category?months=12&groupBy=month&type=expense`

### Old: `/api/analytics/breakdown?type=expense&months=3`
### New: `/api/analytics/unified-category?type=expense&months=3&groupBy=category`

### Old: `/api/analytics/category-details?category=Food&startDate=2024-01-01`
### New: `/api/analytics/unified-category?category=Food&startDate=2024-01-01&includeTransactions=true`

## Timeline for Removal

These endpoints will be removed in the next major version. Please migrate to the unified endpoint.