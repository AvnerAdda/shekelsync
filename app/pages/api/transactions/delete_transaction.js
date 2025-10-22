import { createApiHandler } from "../utils/apiHandler";

const handler = createApiHandler({
  validate: (req) => {
    if (req.method !== 'DELETE') {
      return "Only DELETE method is allowed";
    }
    const { name, date, price, category, categoryDefinitionId } = req.body;
    if (!name || !date || price === undefined) {
      return "Name, date, and price are required";
    }
    if (!category && !categoryDefinitionId) {
      return "Provide either categoryDefinitionId or category";
    }
  },
  query: async (req) => {
    const { name, date, price, category, categoryDefinitionId } = req.body;

    if (categoryDefinitionId) {
      return {
        sql: `
          DELETE FROM transactions
          WHERE name = $1
            AND date = $2
            AND price = $3
            AND category_definition_id = $4
        `,
        params: [name, new Date(date), price, categoryDefinitionId]
      };
    }

    return {
      sql: `
        DELETE FROM transactions 
        WHERE name = $1 
        AND date = $2 
        AND price = $3 
        AND category = $4
      `,
      params: [name, new Date(date), price, category]
    };
  },
  transform: (_) => {
    return { success: true };
  }
});

export default handler; 
