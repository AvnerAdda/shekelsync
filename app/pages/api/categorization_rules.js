import { createApiHandler } from "@/lib/server/api-handler.js";

const handler = createApiHandler({
  validate: (req) => {
    if (!['GET', 'POST', 'PUT', 'DELETE'].includes(req.method)) {
      return "Only GET, POST, PUT, and DELETE methods are allowed";
    }

    if (req.method === 'POST') {
      const { name_pattern, category_definition_id, target_category } = req.body;
      if (!name_pattern || (!category_definition_id && !target_category)) {
        return "name_pattern and either category_definition_id or target_category are required";
      }
    }

    if (req.method === 'PUT') {
      const { id } = req.body;
      if (!id) {
        return "id is required";
      }
    }

    if (req.method === 'DELETE') {
      const id = req.query.id || req.body?.id;
      if (!id) {
        return "id is required";
      }
    }
  },
  query: async (req) => {
    if (req.method === 'GET') {
      return {
        sql: `
          SELECT
            cr.id,
            cr.name_pattern,
            cr.category_definition_id,
            cr.category_type,
            cr.category_path,
            cr.is_active,
            cr.priority,
            cr.created_at,
            cr.updated_at,
            cd.name as category_name,
            cd.name_en as category_name_en,
            cd.hierarchy_path,
            cd.depth_level
          FROM categorization_rules cr
          LEFT JOIN category_definitions cd ON cr.category_definition_id = cd.id
          ORDER BY cr.priority DESC, cr.created_at DESC
        `,
        params: []
      };
    }

    if (req.method === 'POST') {
      const { name_pattern, target_category, category_definition_id, category_type, priority } = req.body;

      // If category_definition_id is provided, we need to fetch the category path
      // This is handled in the transform function
      return {
        sql: `SELECT 1`, // Dummy query, actual INSERT happens in transform
        params: []
      };
    }

    if (req.method === 'PUT') {
      const { id, name_pattern, target_category, category_definition_id, category_type, category_path, is_active, priority } = req.body;

      // Build dynamic update based on provided fields
      const updates = [];
      const params = [id];
      let paramIndex = 2;

      if (name_pattern !== undefined) {
        updates.push(`name_pattern = $${paramIndex}`);
        params.push(name_pattern);
        paramIndex++;
      }

      if (target_category !== undefined) {
        updates.push(`target_category = $${paramIndex}`);
        params.push(target_category);
        paramIndex++;
      }

      if (category_definition_id !== undefined) {
        updates.push(`category_definition_id = $${paramIndex}`);
        params.push(category_definition_id);
        paramIndex++;
      }

      if (category_type !== undefined) {
        updates.push(`category_type = $${paramIndex}`);
        params.push(category_type);
        paramIndex++;
      }

      if (category_path !== undefined) {
        updates.push(`category_path = $${paramIndex}`);
        params.push(category_path);
        paramIndex++;
      }

      if (is_active !== undefined) {
        updates.push(`is_active = $${paramIndex}`);
        params.push(is_active);
        paramIndex++;
      }

      if (priority !== undefined) {
        updates.push(`priority = $${paramIndex}`);
        params.push(priority);
        paramIndex++;
      }

      updates.push('updated_at = CURRENT_TIMESTAMP');

      return {
        sql: `
          UPDATE categorization_rules
          SET ${updates.join(', ')}
          WHERE id = $1
          RETURNING id, name_pattern, target_category, category_definition_id, category_type, category_path, is_active, priority, created_at, updated_at
        `,
        params: params
      };
    }

    if (req.method === 'DELETE') {
      const id = req.query.id || req.body?.id;
      return {
        sql: `
          DELETE FROM categorization_rules
          WHERE id = $1
        `,
        params: [id]
      };
    }
  },
  transform: async (result, req) => {
    if (req.method === 'GET') {
      return result.rows;
    }

    if (req.method === 'POST') {
      const { name_pattern, target_category, category_definition_id, category_type, priority } = req.body;
      const { getDB } = await import('./db.js');
      const client = await getDB();

      try {
        let finalTargetCategory = target_category;
        let finalCategoryType = category_type;
        let categoryPath = null;

        // If category_definition_id is provided, fetch the category details and build path
        if (category_definition_id) {
          const categoryResult = await client.query(
            `WITH RECURSIVE category_tree AS (
              SELECT
                cd.id,
                cd.parent_id,
                cd.name,
                cd.category_type,
                cd.name as path
              FROM category_definitions cd
              WHERE cd.id = $1

              UNION ALL

              SELECT
                parent.id,
                parent.parent_id,
                parent.name,
                parent.category_type,
                parent.name || ' > ' || ct.path as path
              FROM category_definitions parent
              JOIN category_tree ct ON parent.id = ct.parent_id
            )
            SELECT path, category_type, name
            FROM category_tree
            WHERE parent_id IS NULL
            LIMIT 1`,
            [category_definition_id]
          );

          if (categoryResult.rows.length > 0) {
            const cat = categoryResult.rows[0];
            finalTargetCategory = cat.name;
            finalCategoryType = cat.category_type;
            categoryPath = cat.path;
          }
        }

        // Insert the rule with duplicate handling
        const insertResult = await client.query(
          `INSERT INTO categorization_rules
            (name_pattern, target_category, category_definition_id, category_type, category_path, priority)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (name_pattern, target_category)
          DO UPDATE SET
            category_definition_id = EXCLUDED.category_definition_id,
            category_type = EXCLUDED.category_type,
            category_path = EXCLUDED.category_path,
            priority = EXCLUDED.priority,
            is_active = true,
            updated_at = CURRENT_TIMESTAMP
          RETURNING id, name_pattern, target_category, category_definition_id, category_type, category_path, is_active, priority, created_at, updated_at`,
          [
            name_pattern,
            finalTargetCategory,
            category_definition_id || null,
            finalCategoryType || null,
            categoryPath,
            priority || 0
          ]
        );

        return insertResult.rows[0];
      } finally {
        client.release();
      }
    }

    if (req.method === 'PUT') {
      return result.rows[0];
    }

    return { success: true };
  }
});

export default handler; 