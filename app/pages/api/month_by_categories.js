import { createApiHandler } from "./utils/apiHandler";

const handler = createApiHandler({
  validate: (req) => {
    const { month } = req.query;
    if (!month) return "Month parameter is required";
  },
  query: async (req) => ({
    sql: `
      SELECT
        COALESCE(parent_category, category) as name,
        MAX(parent_category) as parent_category,
        MAX(subcategory) as subcategory,
        COUNT(*) AS transaction_count,
        ROUND(SUM(price)) AS value,
        COUNT(CASE WHEN auto_categorized = true THEN 1 END) as auto_count
      FROM transactions
      WHERE TO_CHAR(date, 'YYYY-MM') = $1
      AND COALESCE(parent_category, category) != 'Bank'
      AND COALESCE(parent_category, category) != 'Income'
      GROUP BY COALESCE(parent_category, category)
      ORDER BY ABS(ROUND(SUM(price))) DESC
    `,
    params: [req.query.month]
  })
});

export default handler;
