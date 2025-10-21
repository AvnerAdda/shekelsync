import { createApiHandler } from "./utils/apiHandler";

const handler = createApiHandler({
  validate: (req) => {
    if (req.method !== 'POST') {
      return "Only POST method is allowed";
    }
    const { sourceCategories, newCategoryName } = req.body;
    if (!sourceCategories || !Array.isArray(sourceCategories) || sourceCategories.length < 2) {
      return "At least 2 source categories are required";
    }
    if (!newCategoryName || typeof newCategoryName !== 'string' || newCategoryName.trim() === '') {
      return "New category name is required";
    }
  },
  query: async (req) => {
    const { sourceCategories, newCategoryName } = req.body;
    const trimmedName = newCategoryName.trim();
    const placeholders = sourceCategories
      .map((_, idx) => `$${idx + 2}`)
      .join(', ');

    // Update all transactions from source categories to the new category
    return {
      sql: `
        UPDATE transactions 
        SET category = $1
        WHERE category IN (${placeholders})
      `,
      params: [trimmedName, ...sourceCategories]
    };
  },
  transform: (result, req) => {
    const { newCategoryName } = req.body;
    return { 
      success: true, 
      message: `Successfully merged categories into "${newCategoryName}"`,
      updatedRows: result.rowCount 
    };
  }
});

export default handler; 
