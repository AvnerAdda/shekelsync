import { createApiHandler } from "./utils/apiHandler";
import { dialect } from "../../lib/sql-dialect.js";

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

    const yearExpr = dialect.toChar("date", "YYYY");
    const monthExpr = dialect.toChar("date", "MM");
    const yearMonthExpr = dialect.toChar("date", "MM-YYYY");
    const yearTrunc = dialect.dateTrunc("year", "date");
    const monthTrunc = dialect.dateTrunc("month", "date");

    if (groupByYearBool) {
      return {
        sql: `
          SELECT
            SUM(price) AS amount,
            ${yearExpr} AS year,
            ${yearTrunc} AS year_sort
          FROM transactions
          WHERE category != 'Bank'
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
        FROM transactions
        WHERE category != 'Bank'
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
