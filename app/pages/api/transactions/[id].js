import { createApiHandler } from "../utils/apiHandler";

const handler = createApiHandler({
  validate: (req) => {
    if (!['DELETE', 'PUT'].includes(req.method)) {
      return "Only DELETE and PUT methods are allowed";
    }
    if (!req.query.id) {
      return "ID parameter is required";
    }
    if (
      req.method === 'PUT' &&
      ![
        'price',
        'category',
        'parent_category',
        'subcategory',
        'category_definition_id',
        'category_type',
        'auto_categorized',
        'confidence_score',
      ].some((field) => req.body?.[field] !== undefined)
    ) {
      return "At least one updatable field is required";
    }
  },
  query: async (req) => {
    const { id } = req.query;
    const [identifier, vendor] = id.split('|');

    if (req.method === 'DELETE') {
      return {
        sql: `
          DELETE FROM transactions 
          WHERE identifier = $1 AND vendor = $2
        `,
        params: [identifier, vendor]
      };
    }

    // PUT method for updating price and/or category
    const updates = [];
    const params = [identifier, vendor];
    let paramIndex = 3;

    if (req.body.price !== undefined) {
      updates.push(`price = $${paramIndex}`);
      params.push(req.body.price);
      paramIndex++;
    }

    if (req.body.category !== undefined) {
      updates.push(`category = $${paramIndex}`);
      params.push(req.body.category);
      paramIndex++;
    }

    if (req.body.parent_category !== undefined) {
      updates.push(`parent_category = $${paramIndex}`);
      params.push(req.body.parent_category);
      paramIndex++;
    }

    if (req.body.subcategory !== undefined) {
      updates.push(`subcategory = $${paramIndex}`);
      params.push(req.body.subcategory);
      paramIndex++;
    }

    if (req.body.category_definition_id !== undefined) {
      updates.push(`category_definition_id = $${paramIndex}`);
      params.push(req.body.category_definition_id);
      paramIndex++;
    }

    if (req.body.category_type !== undefined) {
      updates.push(`category_type = $${paramIndex}`);
      params.push(req.body.category_type);
      paramIndex++;
    }

    if (req.body.auto_categorized !== undefined) {
      updates.push(`auto_categorized = $${paramIndex}`);
      params.push(req.body.auto_categorized);
      paramIndex++;
    }

    if (req.body.confidence_score !== undefined) {
      updates.push(`confidence_score = $${paramIndex}`);
      params.push(req.body.confidence_score);
      paramIndex++;
    }

    return {
      sql: `
        UPDATE transactions 
        SET ${updates.join(', ')}
        WHERE identifier = $1 AND vendor = $2
      `,
      params: params
    };
  },
  transform: (_) => {
    return { success: true };
  }
});

export default handler; 