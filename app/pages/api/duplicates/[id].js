import { getDB } from '../db.js';

/**
 * Delete/unconfirm a duplicate transaction pair
 * DELETE /api/duplicates/:id
 */
export default async function handler(req, res) {
  if (req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const client = await getDB();

  try {
    const { id } = req.query;

    if (!id) {
      return res.status(400).json({ error: 'Duplicate ID is required' });
    }

    // Delete the duplicate record
    const deleteResult = await client.query(
      'DELETE FROM transaction_duplicates WHERE id = $1 RETURNING id',
      [parseInt(id)]
    );

    if (deleteResult.rows.length === 0) {
      return res.status(404).json({ error: 'Duplicate not found' });
    }

    res.status(200).json({
      message: 'Duplicate unconfirmed successfully',
      deletedId: deleteResult.rows[0].id
    });

  } catch (error) {
    console.error('Error deleting duplicate:', error);
    res.status(500).json({
      error: 'Failed to delete duplicate',
      details: error.message
    });
  } finally {
    client.release();
  }
}
