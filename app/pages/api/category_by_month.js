import { createApiHandler } from "@/lib/server/api-handler.js";
import { dialect } from "../../lib/sql-dialect.js";

const handler = createApiHandler({
  validate: (req) => {
    const { category, categoryId, month, groupByYear } = req.query;
    if (!month || !groupByYear) {
      return "month and groupByYear are required";
    }
    if (!categoryId && !category) {
      return "categoryId or category is required";
    }
  },
  query: async (req) => {
    const { category, categoryId: rawCategoryId, month, groupByYear } = req.query;
    const groupByYearBool = groupByYear === "true";
    const limit = parseInt(month, 10);
    if (Number.isNaN(limit)) {
      throw new Error("Invalid month parameter");
    }
    const categoryId =
      rawCategoryId !== undefined ? parseInt(rawCategoryId, 10) : undefined;

    if (rawCategoryId !== undefined && Number.isNaN(categoryId)) {
      throw new Error("Invalid categoryId parameter");
    }

    const yearExpr = dialect.toChar("t.date", "YYYY");
    const monthExpr = dialect.toChar("t.date", "MM");
    const yearMonthExpr = dialect.toChar("t.date", "MM-YYYY");
    const yearTrunc = dialect.dateTrunc("year", "t.date");
    const monthTrunc = dialect.dateTrunc("month", "t.date");

    if (categoryId) {
      const params = [categoryId, limit];

      if (groupByYearBool) {
        return {
          sql: `
            WITH RECURSIVE category_tree AS (
              SELECT id FROM category_definitions WHERE id = $1
              UNION ALL
              SELECT cd.id
              FROM category_definitions cd
              JOIN category_tree ct ON cd.parent_id = ct.id
            ),
            temp AS (
              SELECT
                SUM(t.price) AS amount,
                ${yearExpr} AS year,
                ${yearTrunc} AS year_sort
              FROM transactions t
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
              WHERE t.category_definition_id IN (SELECT id FROM category_tree)
                AND ap.id IS NULL
              GROUP BY ${yearExpr}, ${yearTrunc}
              ORDER BY year_sort DESC
              LIMIT $2
            )
            SELECT amount, year
            FROM temp
            ORDER BY year ASC
          `,
          params
        };
      }

      return {
        sql: `
          WITH RECURSIVE category_tree AS (
            SELECT id FROM category_definitions WHERE id = $1
            UNION ALL
            SELECT cd.id
            FROM category_definitions cd
            JOIN category_tree ct ON cd.parent_id = ct.id
          ),
          temp AS (
            SELECT
              SUM(t.price) AS amount,
              ${yearExpr} AS year,
              ${monthExpr} AS month,
              ${yearMonthExpr} AS year_month,
              ${monthTrunc} AS month_sort
            FROM transactions t
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
            WHERE t.category_definition_id IN (SELECT id FROM category_tree)
              AND ap.id IS NULL
            GROUP BY ${yearExpr}, ${monthExpr}, ${yearMonthExpr}, ${monthTrunc}
            ORDER BY month_sort DESC
            LIMIT $2
          )
          SELECT amount, year, month, year_month
          FROM temp
          ORDER BY year ASC, month ASC
        `,
        params
      };
    }

    // Legacy fallback using category text
    const params = [category, limit];

    if (groupByYearBool) {
      return {
        sql: `
          WITH temp AS (
            SELECT
              SUM(t.price) AS amount,
              ${yearExpr} AS year,
              ${yearTrunc} AS year_sort
            FROM transactions t
            WHERE t.category = $1
            GROUP BY ${yearExpr}, ${yearTrunc}
            ORDER BY year_sort DESC
            LIMIT $2
          )
          SELECT amount, year
          FROM temp
          ORDER BY year ASC
        `,
        params
      };
    }

    return {
      sql: `
        WITH temp AS (
          SELECT
            SUM(t.price) AS amount,
            ${yearExpr} AS year,
            ${monthExpr} AS month,
            ${yearMonthExpr} AS year_month,
            ${monthTrunc} AS month_sort
          FROM transactions t
          WHERE t.category = $1
          GROUP BY ${yearExpr}, ${monthExpr}, ${yearMonthExpr}, ${monthTrunc}
          ORDER BY month_sort DESC
          LIMIT $2
        )
        SELECT amount, year, month, year_month
        FROM temp
        ORDER BY year ASC, month ASC
      `,
      params
    };
  }
});

export default handler;
