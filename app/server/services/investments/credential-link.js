const { dialect } = require('../../../lib/sql-dialect.js');

// Arguments are trusted SQL column/parameter expressions, never user values.
// Appending a delimiter also matches an id stored at the end of the notes.
function credentialIdMatchSql(notesExpression, credentialIdExpression) {
  // SQLite can bind a JS number as REAL; normalize 1.0 back to the stored id 1.
  const idText = `CAST(CAST(${credentialIdExpression} AS BIGINT) AS TEXT)`;
  return dialect.useSqlite
    ? `(COALESCE(${notesExpression}, '') || ' ') GLOB ('*credential_id:' || ${idText} || '[^0-9]*')`
    : `COALESCE(${notesExpression}, '') ~ ('credential_id:' || ${idText} || '([^0-9]|$)')`;
}

module.exports = { credentialIdMatchSql };
