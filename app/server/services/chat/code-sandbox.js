/**
 * Code Sandbox Module
 * Provides safe execution of AI-generated JavaScript code using Node's vm module
 *
 * Security constraints:
 * - No file system access
 * - No network access
 * - No process spawning
 * - No require/import
 * - Execution timeout: 5 seconds
 * - Read-only database access only
 */

const vm = require('vm');

// SQL patterns for validation
const READ_ONLY_PATTERNS = [
  /^\s*select\s/i,
  /^\s*with\s+.*\s+select\s/i,
];

const DANGEROUS_PATTERNS = [
  /\binsert\b/i,
  /\bupdate\b/i,
  /\bdelete\b/i,
  /\bdrop\b/i,
  /\balter\b/i,
  /\bcreate\b/i,
  /\btruncate\b/i,
  /\breplace\b/i,
  /\battach\b/i,
  /\bdetach\b/i,
  /\bpragma\b/i,
  /\bvacuum\b/i,
];

// Dangerous JS patterns to block
const DANGEROUS_JS_PATTERNS = [
  /\brequire\s*\(/i,
  /\bimport\s*\(/i,
  /\beval\s*\(/i,
  /\bFunction\s*\(/i,
  /\bprocess\b/i,
  /\bglobal\b/i,
  /\bglobalThis\b/i,
  /\b__dirname\b/i,
  /\b__filename\b/i,
  /\bmodule\b/i,
  /\bexports\b/i,
  /\bBuffer\b/i,
  /\bsetTimeout\b/i,
  /\bsetInterval\b/i,
  /\bsetImmediate\b/i,
  /\bclearTimeout\b/i,
  /\bclearInterval\b/i,
  /\bclearImmediate\b/i,
];

/**
 * Validate that a SQL query is read-only
 * @param {string} sql - The SQL query to validate
 * @returns {Object} Validation result with isValid and error
 */
function validateSQL(sql) {
  if (!sql || typeof sql !== 'string') {
    return { isValid: false, error: 'SQL query is required' };
  }

  const normalized = sql.trim();

  // Check for read-only patterns
  const isReadOnly = READ_ONLY_PATTERNS.some(p => p.test(normalized));
  if (!isReadOnly) {
    return { isValid: false, error: 'Only SELECT queries are allowed' };
  }

  // Check for dangerous patterns
  const hasDangerous = DANGEROUS_PATTERNS.some(p => p.test(normalized));
  if (hasDangerous) {
    return { isValid: false, error: 'Query contains forbidden keywords' };
  }

  // Check for multiple statements (semicolon followed by non-whitespace)
  if (/;\s*\S/.test(normalized)) {
    return { isValid: false, error: 'Multiple statements are not allowed' };
  }

  return { isValid: true };
}

/**
 * Validate that JavaScript code is safe to execute
 * @param {string} code - The JavaScript code to validate
 * @returns {Object} Validation result with isValid and error
 */
function validateJS(code) {
  if (!code || typeof code !== 'string') {
    return { isValid: false, error: 'Code is required' };
  }

  // Check for dangerous patterns
  for (const pattern of DANGEROUS_JS_PATTERNS) {
    if (pattern.test(code)) {
      return { isValid: false, error: `Code contains forbidden pattern: ${pattern.source}` };
    }
  }

  return { isValid: true };
}

/**
 * Create a sandboxed execution environment
 * @param {Function} dbQueryFn - Function to execute read-only SQL queries
 * @returns {Object} Sandbox instance with execute methods
 */
function createSandbox(dbQueryFn) {
  return {
    /**
     * Execute a SQL query in a sandboxed context
     * @param {string} sql - The SQL query to execute
     * @returns {Promise<Object>} Result with success flag and data or error
     */
    async executeSQL(sql) {
      const validation = validateSQL(sql);
      if (!validation.isValid) {
        return { success: false, error: validation.error };
      }

      try {
        const result = await dbQueryFn(sql);
        return {
          success: true,
          data: result,
          rowCount: Array.isArray(result) ? result.length : 0,
        };
      } catch (error) {
        return {
          success: false,
          error: `Query error: ${error.message}`,
        };
      }
    },

    /**
     * Execute JavaScript code in a sandboxed VM context
     * @param {string} code - The JavaScript code to execute
     * @param {Object} data - Data to make available in the sandbox
     * @param {Object} options - Execution options
     * @returns {Promise<Object>} Result with success flag and result or error
     */
    async executeCode(code, data = {}, options = {}) {
      const timeout = options.timeout || 5000;

      // Validate code first
      const validation = validateJS(code);
      if (!validation.isValid) {
        return { success: false, error: validation.error };
      }

      try {
        // Create a safe context with only allowed globals
        const safeContext = {
          // Data from queries
          data: JSON.parse(JSON.stringify(data)), // Deep copy to isolate

          // Safe Math utilities
          Math,
          Number,
          parseInt,
          parseFloat,
          isNaN,
          isFinite,
          NaN,
          Infinity,

          // Safe array/object utilities
          Array,
          Object,
          JSON,
          String,
          Date,

          // Custom utility functions
          sum: (arr) => Array.isArray(arr) ? arr.reduce((a, b) => a + (Number(b) || 0), 0) : 0,
          avg: (arr) => Array.isArray(arr) && arr.length ? arr.reduce((a, b) => a + (Number(b) || 0), 0) / arr.length : 0,
          min: (arr) => Array.isArray(arr) && arr.length ? Math.min(...arr.map(Number).filter(n => !isNaN(n))) : 0,
          max: (arr) => Array.isArray(arr) && arr.length ? Math.max(...arr.map(Number).filter(n => !isNaN(n))) : 0,
          round: (n, decimals = 2) => {
            const factor = Math.pow(10, decimals);
            return Math.round(Number(n) * factor) / factor;
          },
          groupBy: (arr, key) => {
            if (!Array.isArray(arr)) return {};
            return arr.reduce((acc, item) => {
              const k = item[key];
              if (!acc[k]) acc[k] = [];
              acc[k].push(item);
              return acc;
            }, {});
          },
          sortBy: (arr, key, desc = false) => {
            if (!Array.isArray(arr)) return [];
            return [...arr].sort((a, b) => {
              const va = a[key], vb = b[key];
              if (va < vb) return desc ? 1 : -1;
              if (va > vb) return desc ? -1 : 1;
              return 0;
            });
          },
          // Financial utilities
          calculateGrowthRate: (initial, final) => {
            if (!initial || initial === 0) return 0;
            return ((final - initial) / Math.abs(initial)) * 100;
          },
          calculateCompoundGrowth: (principal, rate, periods) => {
            return principal * Math.pow(1 + rate / 100, periods);
          },

          // Result container
          __result: undefined,
        };

        // Create VM context
        const context = vm.createContext(safeContext);

        // Wrap code to capture result
        const wrappedCode = `
          try {
            __result = (function() {
              ${code}
            })();
          } catch (e) {
            __result = { __error: e.message };
          }
        `;

        // Execute with timeout
        const script = new vm.Script(wrappedCode);
        script.runInContext(context, { timeout });

        // Check for execution error
        const result = context.__result;
        if (result && typeof result === 'object' && result.__error) {
          return { success: false, error: result.__error };
        }

        return { success: true, result };

      } catch (error) {
        if (error.message.includes('Script execution timed out')) {
          return {
            success: false,
            error: 'Calculation took too long. Try a simpler operation.',
          };
        }
        return {
          success: false,
          error: `Execution error: ${error.message}`,
        };
      }
    },

    /**
     * Dispose of resources (no-op for vm-based sandbox)
     */
    dispose() {
      // Nothing to clean up with vm module
    },
  };
}

module.exports = {
  createSandbox,
  validateSQL,
  validateJS,
};
