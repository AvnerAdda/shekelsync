import { createApiHandler } from "@/lib/server/api-handler.js";
import { dialect } from "../../lib/sql-dialect.js";
import { BANK_CATEGORY_NAME } from "../../lib/category-constants.js";

const handler = createApiHandler({
  validate: (req) => {
    const { month, groupByYear } = req.query;
    if (!month || !groupByYear) {
      return "month and groupByYear are required";
    }
  },
  query: async (req) => {
    const { month, groupByYear } = req.query;
    const groupByYearBool = groupByYear === "true";
    const monthNumber = parseInt(month, 10);

    const yearExpr = dialect.toChar("t.date", "YYYY");
    const monthExpr = dialect.toChar("t.date", "MM");
    const yearMonthExpr = dialect.toChar("t.date", "MM-YYYY");
    const yearTrunc = dialect.dateTrunc("year", "t.date");
    const monthTrunc = dialect.dateTrunc("month", "t.date");

    if (groupByYearBool) {
      return {
        sql: `
          SELECT
            SUM(price) AS amount,
            ${yearExpr} AS year,
            ${yearTrunc} AS year_sort
          FROM transactions t
          JOIN category_definitions cd ON cd.id = t.category_definition_id
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
          WHERE cd.name != '${BANK_CATEGORY_NAME}'
            AND cd.category_type = 'expense'
            AND ap.id IS NULL
          GROUP BY ${yearExpr}, ${yearTrunc}
          ORDER BY year_sort DESC
          LIMIT $1
        `,
        params: [monthNumber]
      };
    }

    return {
      sql: `
        SELECT
          SUM(price) AS amount,
          ${yearExpr} AS year,
          ${monthExpr} AS month,
          ${yearMonthExpr} AS year_month,
          ${monthTrunc} AS year_sort
        FROM transactions t
        JOIN category_definitions cd ON cd.id = t.category_definition_id
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
        WHERE cd.name != '${BANK_CATEGORY_NAME}'
          AND cd.category_type = 'expense'
          AND ap.id IS NULL
        GROUP BY
          ${yearExpr},
          ${monthExpr},
          ${yearMonthExpr},
          ${monthTrunc}
        ORDER BY year_sort DESC
        LIMIT $1
      `,
      params: [monthNumber]
    };
  },
  transform: (result) => {
    return result.rows.map(row => ({
      ...row,
      amount: parseFloat(row.amount) || 0
    }));
  }
});

export default handler; 
