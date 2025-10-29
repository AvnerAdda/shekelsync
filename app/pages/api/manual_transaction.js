import { createApiHandler } from "./utils/apiHandler";
import { getDB } from "./db.js";
import { INCOME_ROOT_NAME } from "../../lib/category-constants.js";

const handler = createApiHandler({
  validate: (req) => {
    if (req.method !== 'POST') {
      return "Only POST method is allowed";
    }
    const { name, amount, date, type, categoryDefinitionId } = req.body;
    if (!name || amount === undefined || !date || !type) {
      return "Name, amount, date, and type are required";
    }
    if (!['income', 'expense'].includes(type)) {
      return "Invalid transaction type";
    }
    if (type === 'expense' && !categoryDefinitionId) {
      return "categoryDefinitionId is required for expense transactions";
    }
  },
  query: async () => ({
    sql: 'SELECT 1',
    params: []
  }),
  transform: async (result, req) => {
    const { name, amount, date, type, categoryDefinitionId } = req.body;
    const client = await getDB();

    try {
      const identifier = `manual_${type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const vendor = type === 'income' ? 'manual_income' : 'manual_expense';
      const price = type === 'income'
        ? Math.abs(Number(amount))
        : -Math.abs(Number(amount));
      const effectiveDate = new Date(date);
      const timestamp = new Date();

      let resolvedCategoryId = categoryDefinitionId || null;

      if (type === 'income' && !resolvedCategoryId) {
        const incomeCategory = await client.query(
          `SELECT id
           FROM category_definitions
           WHERE name = $1
           LIMIT 1`,
          [INCOME_ROOT_NAME]
        );
        resolvedCategoryId = incomeCategory.rows[0]?.id || null;
      }

      if (!resolvedCategoryId) {
        throw new Error('Unable to resolve category definition for manual transaction');
      }

      const categoryInfo = await client.query(
        `SELECT
           cd.id,
           cd.name,
           cd.category_type,
           cd.parent_id,
           parent.name AS parent_name
         FROM category_definitions cd
         LEFT JOIN category_definitions parent ON parent.id = cd.parent_id
         WHERE cd.id = $1`,
        [resolvedCategoryId]
      );

      if (categoryInfo.rows.length === 0) {
        throw new Error(`Category definition ${resolvedCategoryId} not found`);
      }

      const categoryRecord = categoryInfo.rows[0];
      const parentName = categoryRecord.parent_name || null;
      const subcategory = categoryRecord.parent_id ? categoryRecord.name : null;
      const categoryLabel = categoryRecord.parent_id
        ? categoryRecord.name
        : categoryRecord.name;

      await client.query(
        `INSERT INTO transactions (
          identifier,
          vendor,
          date,
          name,
          price,
          category_definition_id,
          category_type,
          type,
          status,
          auto_categorized,
          confidence_score,
          processed_date,
          transaction_datetime,
          processed_datetime
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, 'completed', false, 1.0, $9, $10, $11
        )`,
        [
          identifier,
          vendor,
          effectiveDate,
          name,
          price,
          resolvedCategoryId,
          categoryRecord.category_type,
          type,
          effectiveDate,
          effectiveDate,
          timestamp
        ]
      );

      return { success: true };
    } finally {
      client.release();
    }
  },
});

export default handler; 
