import pool from '../db.js';
import { buildDuplicateFilter } from '../analytics/utils.js';

/**
 * API endpoint for managing hierarchical categories
 *
 * GET: Fetch all categories with hierarchy and transaction counts
 * POST: Create new category
 * PUT: Update existing category
 * DELETE: Delete category (and its children)
 */

export default async function handler(req, res) {
  const { method } = req;

  try {
    switch (method) {
      case 'GET':
        return await handleGet(req, res);
      case 'POST':
        return await handlePost(req, res);
      case 'PUT':
        return await handlePut(req, res);
      case 'DELETE':
        return await handleDelete(req, res);
      default:
        return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('Category hierarchy API error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

/**
 * GET: Fetch all categories with transaction counts
 */
async function handleGet(req, res) {
  const { type, includeInactive } = req.query;

  try {
    let query = `
      SELECT
        cd.id,
        cd.name,
        cd.parent_id,
        cd.category_type,
        cd.display_order,
        cd.icon,
        cd.color,
        cd.description,
        cd.is_active,
        cd.created_at,
        cd.updated_at,
        COUNT(DISTINCT t.identifier || '-' || t.vendor) as transaction_count,
        COALESCE(SUM(ABS(t.price)), 0) as total_amount
      FROM category_definitions cd
      LEFT JOIN transactions t ON t.category_definition_id = cd.id
    `;

    const conditions = [];
    const params = [];

    if (!includeInactive) {
      conditions.push('cd.is_active = true');
    }

    if (type) {
      conditions.push(`cd.category_type = $${params.length + 1}`);
      params.push(type);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += `
      GROUP BY cd.id, cd.name, cd.parent_id, cd.category_type, cd.display_order,
               cd.icon, cd.color, cd.description, cd.is_active, cd.created_at, cd.updated_at
      ORDER BY cd.category_type, cd.display_order, cd.name
    `;

    const duplicateFilter = await buildDuplicateFilter(pool, 't');

    const [categoryResult, uncategorizedSummary, uncategorizedRecent] = await Promise.all([
      pool.query(query, params),
      pool.query(
        `SELECT COUNT(*) AS total_transactions, COALESCE(SUM(ABS(price)), 0) AS total_amount
         FROM transactions t
         WHERE t.category_definition_id IS NULL
         ${duplicateFilter}`
      ),
      pool.query(
        `SELECT identifier, vendor, name, date, price, account_number
         FROM transactions t
         WHERE t.category_definition_id IS NULL
         ${duplicateFilter}
         ORDER BY date DESC
         LIMIT 50`
      ),
    ]);

    const summaryRow = uncategorizedSummary.rows[0] || { total_transactions: 0, total_amount: 0 };

    return res.status(200).json({
      categories: categoryResult.rows,
      uncategorized: {
        totalCount: parseInt(summaryRow.total_transactions, 10) || 0,
        totalAmount: parseFloat(summaryRow.total_amount) || 0,
        recentTransactions: uncategorizedRecent.rows.map(row => ({
          identifier: row.identifier,
          vendor: row.vendor,
          name: row.name,
          date: row.date,
          price: parseFloat(row.price),
          accountNumber: row.account_number,
        })),
      },
    });
  } catch (error) {
    console.error('Error fetching categories:', error);
    throw error;
  }
}

/**
 * POST: Create new category
 */
async function handlePost(req, res) {
  const { name, parent_id, category_type, icon, color, description, display_order } = req.body;

  if (!name || !category_type) {
    return res.status(400).json({ error: 'Name and category_type are required' });
  }

  if (!['expense', 'investment', 'income'].includes(category_type)) {
    return res.status(400).json({ error: 'Invalid category_type. Must be expense, investment, or income' });
  }

  try {
    // Check if category already exists
    const checkQuery = `
      SELECT id FROM category_definitions
      WHERE name = $1 AND parent_id IS NOT DISTINCT FROM $2 AND category_type = $3
    `;
    const checkResult = await pool.query(checkQuery, [name, parent_id || null, category_type]);

    if (checkResult.rows.length > 0) {
      return res.status(400).json({ error: 'Category with this name already exists at this level' });
    }

    // If parent_id is provided, verify it exists and has same category_type
    if (parent_id) {
      const parentCheck = await pool.query(
        'SELECT category_type FROM category_definitions WHERE id = $1',
        [parent_id]
      );

      if (parentCheck.rows.length === 0) {
        return res.status(400).json({ error: 'Parent category not found' });
      }

      if (parentCheck.rows[0].category_type !== category_type) {
        return res.status(400).json({ error: 'Parent category must be of the same type' });
      }
    }

    // Determine display_order if not provided
    let finalDisplayOrder = display_order;
    if (finalDisplayOrder === undefined) {
      const orderQuery = `
        SELECT COALESCE(MAX(display_order), 0) + 1 as next_order
        FROM category_definitions
        WHERE parent_id IS NOT DISTINCT FROM $1 AND category_type = $2
      `;
      const orderResult = await pool.query(orderQuery, [parent_id || null, category_type]);
      finalDisplayOrder = orderResult.rows[0].next_order;
    }

    // Insert new category
    const insertQuery = `
      INSERT INTO category_definitions
        (name, parent_id, category_type, icon, color, description, display_order, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, $7, true)
      RETURNING *
    `;

    const result = await pool.query(insertQuery, [
      name,
      parent_id || null,
      category_type,
      icon || null,
      color || null,
      description || null,
      finalDisplayOrder,
    ]);

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating category:', error);
    throw error;
  }
}

/**
 * PUT: Update existing category
 */
async function handlePut(req, res) {
  const { id, name, icon, color, description, display_order, is_active } = req.body;

  if (!id) {
    return res.status(400).json({ error: 'Category ID is required' });
  }

  try {
    // Build update query dynamically based on provided fields
    const updates = [];
    const params = [id];
    let paramCount = 2;

    if (name !== undefined) {
      updates.push(`name = $${paramCount}`);
      params.push(name);
      paramCount++;
    }

    if (icon !== undefined) {
      updates.push(`icon = $${paramCount}`);
      params.push(icon);
      paramCount++;
    }

    if (color !== undefined) {
      updates.push(`color = $${paramCount}`);
      params.push(color);
      paramCount++;
    }

    if (description !== undefined) {
      updates.push(`description = $${paramCount}`);
      params.push(description);
      paramCount++;
    }

    if (display_order !== undefined) {
      updates.push(`display_order = $${paramCount}`);
      params.push(display_order);
      paramCount++;
    }

    if (is_active !== undefined) {
      updates.push(`is_active = $${paramCount}`);
      params.push(is_active);
      paramCount++;
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');

    const updateQuery = `
      UPDATE category_definitions
      SET ${updates.join(', ')}
      WHERE id = $1
      RETURNING *
    `;

    const result = await pool.query(updateQuery, params);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Category not found' });
    }

    return res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error('Error updating category:', error);
    throw error;
  }
}

/**
 * DELETE: Delete category and its children
 */
async function handleDelete(req, res) {
  const { id } = req.query;

  if (!id) {
    return res.status(400).json({ error: 'Category ID is required' });
  }

  try {
    // Check if category has transactions
    const txnCheck = await pool.query(
      'SELECT COUNT(*) as count FROM transactions WHERE category_definition_id = $1',
      [id]
    );

    if (parseInt(txnCheck.rows[0].count) > 0) {
      return res.status(400).json({
        error: 'Cannot delete category with existing transactions. Please reassign transactions first.',
      });
    }

    // Check if category has children
    const childCheck = await pool.query(
      'SELECT COUNT(*) as count FROM category_definitions WHERE parent_id = $1',
      [id]
    );

    if (parseInt(childCheck.rows[0].count) > 0) {
      return res.status(400).json({
        error: 'Cannot delete category with subcategories. Please delete subcategories first.',
      });
    }

    // Delete category
    const deleteQuery = 'DELETE FROM category_definitions WHERE id = $1 RETURNING *';
    const result = await pool.query(deleteQuery, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Category not found' });
    }

    return res.status(200).json({ message: 'Category deleted successfully', category: result.rows[0] });
  } catch (error) {
    console.error('Error deleting category:', error);
    throw error;
  }
}
