import { createApiHandler } from "./utils/apiHandler";
import { dialect } from "../../lib/sql-dialect.js";

const handler = createApiHandler({
  validate: (req) => {
    const { month, category, categoryId, all } = req.query;
    if (!month) return "Month parameter is required";
    if (!categoryId && !category && all !== "true") {
      return "Either categoryId/category or all=true is required";
    }
  },
  query: async (req) => {
    const { month, category, categoryId: rawCategoryId, all } = req.query;
    const categoryId = rawCategoryId !== undefined ? parseInt(rawCategoryId, 10) : undefined;
    if (rawCategoryId !== undefined && Number.isNaN(categoryId)) {
      throw new Error("Invalid categoryId parameter");
    }
    const monthExpr = dialect.toChar("t.date", "YYYY-MM");

    // Return all transactions for a month (or all months)
    if (all === "true") {
      const params = [];
      const whereClauses = [];

      if (month && month !== "all") {
        params.push(month);
        whereClauses.push(`${monthExpr} = $${params.length}`);
      }

      const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

      return {
        sql: `
          SELECT
            t.name,
            t.price,
            t.date,
            t.identifier,
            t.vendor,
            t.account_number,
            t.category_definition_id,
            cd.name AS category_name,
            cd.name_en AS category_name_en,
            cd.category_type,
            parent.id AS parent_category_definition_id,
            parent.name AS parent_category_name,
            parent.name_en AS parent_category_name_en
          FROM transactions t
          LEFT JOIN category_definitions cd ON cd.id = t.category_definition_id
          LEFT JOIN category_definitions parent ON parent.id = cd.parent_id
          ${whereSql}
          ORDER BY t.date DESC
        `,
        params
      };
    }

    // Filter by a specific category definition (including its children)
    if (categoryId) {
      const params = [categoryId];
      let monthClause = "";

      if (month && month !== "all") {
        params.push(month);
        monthClause = `AND ${monthExpr} = $${params.length}`;
      }

      return {
        sql: `
          WITH RECURSIVE category_tree AS (
            SELECT id FROM category_definitions WHERE id = $1
            UNION ALL
            SELECT cd.id
            FROM category_definitions cd
            JOIN category_tree ct ON cd.parent_id = ct.id
          )
          SELECT
            t.name,
            t.price,
            t.date,
            t.identifier,
            t.vendor,
            t.account_number,
            t.category_definition_id,
            cd.name AS category_name,
            cd.name_en AS category_name_en,
            cd.category_type,
            parent.id AS parent_category_definition_id,
            parent.name AS parent_category_name,
            parent.name_en AS parent_category_name_en
          FROM transactions t
          LEFT JOIN category_definitions cd ON cd.id = t.category_definition_id
          LEFT JOIN category_definitions parent ON parent.id = cd.parent_id
          WHERE t.category_definition_id IN (SELECT id FROM category_tree)
          ${monthClause}
          ORDER BY t.date DESC
        `,
        params
      };
    }

    // No fallback needed - after migration, all transactions have category_definition_id
    throw new Error('Category filtering requires categoryId parameter');
  }
});

export default handler;
