import { createApiHandler } from "@/lib/server/api-handler.js";
import { dialect } from "../../lib/sql-dialect.js";

const handler = createApiHandler({
  validate: (req) => {
    const { month } = req.query;
    if (!month) return "Month parameter is required";
  },
  query: async (req) => ({
    sql: `
      WITH monthly_transactions AS (
        SELECT
          t.price,
          t.auto_categorized,
          cd.id AS category_id,
          cd.name AS category_name,
          cd.name_en AS category_name_en,
          cd.icon AS category_icon,
          cd.color AS category_color,
          cd.category_type AS category_type,
          cd.parent_id AS parent_id,
          parent.id AS parent_category_id,
          parent.name AS parent_category_name,
          parent.name_en AS parent_category_name_en,
          parent.icon AS parent_category_icon,
          parent.color AS parent_category_color,
          parent.category_type AS parent_category_type
        FROM transactions t
        LEFT JOIN category_definitions cd ON cd.id = t.category_definition_id
        LEFT JOIN category_definitions parent ON parent.id = cd.parent_id
        LEFT JOIN account_pairings ap ON (
          t.vendor = ap.bank_vendor
          AND ap.is_active = 1
          AND (ap.bank_account_number IS NULL OR ap.bank_account_number = t.account_number)
          AND ap.match_patterns IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM json_each(ap.match_patterns)
            WHERE LOWER(t.name) LIKE '%' || LOWER(json_each.value) || '%'
          )
        )
        WHERE ${dialect.toChar("t.date", "YYYY-MM")} = $1
          AND t.category_definition_id IS NOT NULL
          AND ap.id IS NULL
      )
      SELECT
        COALESCE(parent_category_id, category_id) AS category_definition_id,
        COALESCE(parent_category_name, category_name) AS name,
        COALESCE(parent_category_name_en, category_name_en) AS name_en,
        COALESCE(parent_category_icon, category_icon) AS icon,
        COALESCE(parent_category_color, category_color) AS color,
        COALESCE(parent_category_type, category_type) AS category_type,
        COUNT(*) AS transaction_count,
        ROUND(SUM(price)) AS value,
        SUM(CASE WHEN auto_categorized = true THEN 1 ELSE 0 END) AS auto_count,
        SUM(CASE WHEN price < 0 THEN ABS(price) ELSE 0 END) AS expenses_total,
        SUM(CASE WHEN price > 0 THEN price ELSE 0 END) AS income_total
      FROM monthly_transactions
      WHERE COALESCE(parent_category_type, category_type) = 'expense'
      GROUP BY
        COALESCE(parent_category_id, category_id),
        COALESCE(parent_category_name, category_name),
        COALESCE(parent_category_name_en, category_name_en),
        COALESCE(parent_category_icon, category_icon),
        COALESCE(parent_category_color, category_color),
        COALESCE(parent_category_type, category_type)
      ORDER BY ABS(SUM(price)) DESC
    `,
    params: [req.query.month]
  }),
  transform: (result) =>
    result.rows.map((row) => ({
      ...row,
      value: parseFloat(row.value) || 0,
      expenses_total: parseFloat(row.expenses_total) || 0,
      income_total: parseFloat(row.income_total) || 0,
      transaction_count: Number(row.transaction_count) || 0,
      auto_count: Number(row.auto_count) || 0
    }))
});

export default handler;
