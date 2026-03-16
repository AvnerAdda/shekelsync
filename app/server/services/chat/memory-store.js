/**
 * Memory Store Module
 * Persists user preferences, goals, and insights across conversations
 */

/**
 * Ensure the chat_memory table exists (idempotent)
 * @param {Object} db - Database client
 */
async function ensureMemoryTable(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS chat_memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      value TEXT NOT NULL,
      category TEXT NOT NULL CHECK (category IN ('preference', 'goal', 'insight')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

/**
 * Save or update a memory entry
 * @param {Object} db - Database client
 * @param {Object} memory - { key, value, category }
 * @returns {Promise<Object>} The saved memory
 */
async function saveMemory(db, { key, value, category }) {
  if (!key || !value || !category) {
    throw new Error('key, value, and category are required');
  }

  const validCategories = ['preference', 'goal', 'insight'];
  if (!validCategories.includes(category)) {
    throw new Error(`Invalid category: ${category}. Must be one of: ${validCategories.join(', ')}`);
  }

  // Upsert: insert or update on conflict
  const result = await db.query(`
    INSERT INTO chat_memory (key, value, category)
    VALUES ($1, $2, $3)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      category = excluded.category,
      updated_at = datetime('now')
    RETURNING id, key, value, category, created_at, updated_at
  `, [key.trim(), value.trim(), category]);

  return result.rows[0];
}

/**
 * Search memories by key or value
 * @param {Object} db - Database client
 * @param {string} searchTerm - Term to search for
 * @returns {Promise<Array>} Matching memories
 */
async function recallMemory(db, searchTerm) {
  if (!searchTerm) return [];

  const term = `%${searchTerm.trim()}%`;
  const result = await db.query(`
    SELECT key, value, category, updated_at
    FROM chat_memory
    WHERE key LIKE $1 OR value LIKE $1
    ORDER BY updated_at DESC
    LIMIT 10
  `, [term]);

  return result.rows;
}

/**
 * Get all memories for system prompt injection
 * @param {Object} db - Database client
 * @returns {Promise<Array>} All memories grouped by category
 */
async function getAllMemories(db) {
  const result = await db.query(`
    SELECT key, value, category
    FROM chat_memory
    ORDER BY category, updated_at DESC
  `);

  return result.rows;
}

/**
 * Delete a memory by key
 * @param {Object} db - Database client
 * @param {string} key - Memory key to delete
 * @returns {Promise<boolean>} True if deleted
 */
async function deleteMemory(db, key) {
  const result = await db.query(
    'DELETE FROM chat_memory WHERE key = $1',
    [key]
  );
  return result.changes > 0;
}

/**
 * Format memories for inclusion in the system prompt
 * @param {Array} memories - Array of memory objects
 * @returns {string} Formatted memory section for the prompt
 */
function formatMemoriesForPrompt(memories) {
  if (!memories || memories.length === 0) return '';

  const grouped = { goal: [], preference: [], insight: [] };
  for (const m of memories) {
    if (grouped[m.category]) {
      grouped[m.category].push(`- ${m.key}: ${m.value}`);
    }
  }

  const parts = ['\n---\nUSER MEMORY (from previous conversations):'];

  if (grouped.goal.length > 0) {
    parts.push('[Goals]');
    parts.push(...grouped.goal);
  }
  if (grouped.preference.length > 0) {
    parts.push('[Preferences]');
    parts.push(...grouped.preference);
  }
  if (grouped.insight.length > 0) {
    parts.push('[Insights]');
    parts.push(...grouped.insight);
  }

  return parts.join('\n');
}

module.exports = {
  ensureMemoryTable,
  saveMemory,
  recallMemory,
  getAllMemories,
  deleteMemory,
  formatMemoriesForPrompt,
};
