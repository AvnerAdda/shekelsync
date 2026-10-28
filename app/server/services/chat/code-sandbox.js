/**
 * Code Sandbox Module
 * Provides safe execution of AI-generated JavaScript code in a QuickJS WASM interpreter.
 * Node's vm module is not a security boundary (host-realm objects leak into the context),
 * so calculations run in a separate engine that has no Node APIs at all.
 *
 * Security constraints:
 * - No file system access
 * - No network access
 * - No process spawning
 * - No require/import
 * - Execution timeout: 5 seconds, memory limit: 32 MB
 * - Read-only database access only
 */

const { newQuickJSWASMModuleFromVariant, shouldInterruptAfterDeadline } = require('quickjs-emscripten-core');
const quickjsReleaseVariant = require('@jitl/quickjs-wasmfile-release-sync');

const MEMORY_LIMIT_BYTES = 32 * 1024 * 1024;
const MAX_STACK_BYTES = 1024 * 1024;
const TIMEOUT_MESSAGE = 'Calculation took too long. Try a simpler operation.';

// Utility functions defined inside the guest, so no host function is ever exposed
const GUEST_HELPERS = `
  const sum = (arr) => Array.isArray(arr) ? arr.reduce((a, b) => a + (Number(b) || 0), 0) : 0;
  const avg = (arr) => Array.isArray(arr) && arr.length ? arr.reduce((a, b) => a + (Number(b) || 0), 0) / arr.length : 0;
  const min = (arr) => Array.isArray(arr) && arr.length ? Math.min(...arr.map(Number).filter(n => !isNaN(n))) : 0;
  const max = (arr) => Array.isArray(arr) && arr.length ? Math.max(...arr.map(Number).filter(n => !isNaN(n))) : 0;
  const round = (n, decimals = 2) => {
    const factor = Math.pow(10, decimals);
    return Math.round(Number(n) * factor) / factor;
  };
  const groupBy = (arr, key) => {
    if (!Array.isArray(arr)) return {};
    return arr.reduce((acc, item) => {
      const k = item[key];
      if (!acc[k]) acc[k] = [];
      acc[k].push(item);
      return acc;
    }, {});
  };
  const sortBy = (arr, key, desc = false) => {
    if (!Array.isArray(arr)) return [];
    return [...arr].sort((a, b) => {
      const va = a[key], vb = b[key];
      if (va < vb) return desc ? 1 : -1;
      if (va > vb) return desc ? -1 : 1;
      return 0;
    });
  };
  const calculateGrowthRate = (initial, final) => {
    if (!initial || initial === 0) return 0;
    return ((final - initial) / Math.abs(initial)) * 100;
  };
  const calculateCompoundGrowth = (principal, rate, periods) => {
    return principal * Math.pow(1 + rate / 100, periods);
  };
`;

let quickjsModulePromise = null;
function loadQuickJS() {
  if (!quickjsModulePromise) {
    quickjsModulePromise = newQuickJSWASMModuleFromVariant(quickjsReleaseVariant.default || quickjsReleaseVariant)
      .catch((error) => {
        quickjsModulePromise = null;
        throw error;
      });
  }
  return quickjsModulePromise;
}

// SQL patterns for validation
const READ_ONLY_PATTERNS = [
  /^\s*select\s/i,
  /^\s*with\s+.*\s+select\s/i,
];

const DANGEROUS_PATTERNS = [
  /\bvendor_credentials\b/i,
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
     * Execute JavaScript code in an isolated QuickJS (WASM) interpreter.
     * The guest has no access to Node, the host realm, the file system or the network;
     * data crosses the boundary only as JSON strings.
     * @param {string} code - The JavaScript code to execute
     * @param {Object} data - Data to make available in the sandbox
     * @param {Object} options - Execution options
     * @returns {Promise<Object>} Result with success flag and result or error
     */
    async executeCode(code, data = {}, options = {}) {
      const timeout = options.timeout || 5000;

      // Validate code first (defense in depth; isolation does not rely on it)
      const validation = validateJS(code);
      if (!validation.isValid) {
        return { success: false, error: validation.error };
      }

      let runtime;
      let context;
      try {
        const quickjs = await loadQuickJS();
        runtime = quickjs.newRuntime();
        runtime.setMemoryLimit(MEMORY_LIMIT_BYTES);
        runtime.setMaxStackSize(MAX_STACK_BYTES);
        const deadline = Date.now() + timeout;
        runtime.setInterruptHandler(shouldInterruptAfterDeadline(deadline));
        context = runtime.newContext();

        const dataJson = context.newString(JSON.stringify(data ?? {}) ?? '{}');
        context.setProp(context.global, '__dataJson', dataJson);
        dataJson.dispose();

        const wrappedCode = `
          ${GUEST_HELPERS}
          const data = JSON.parse(__dataJson);
          let __out;
          try {
            const __value = (function() {
              ${code}
            })();
            __out = { ok: true, value: __value === undefined ? null : __value };
          } catch (e) {
            __out = { ok: false, error: String(e && e.message !== undefined ? e.message : e) };
          }
          JSON.stringify(__out);
        `;

        const evaluation = context.evalCode(wrappedCode, 'calculation.js');
        if (evaluation.error) {
          const failure = context.dump(evaluation.error);
          evaluation.error.dispose();
          const message = failure && typeof failure === 'object' ? failure.message : String(failure);
          if (Date.now() >= deadline || /interrupted/i.test(message || '')) {
            return { success: false, error: TIMEOUT_MESSAGE };
          }
          return { success: false, error: `Execution error: ${message}` };
        }

        const serialized = context.getString(evaluation.value);
        evaluation.value.dispose();
        const outcome = JSON.parse(serialized);
        if (!outcome.ok) {
          return { success: false, error: outcome.error };
        }

        return { success: true, result: outcome.value };

      } catch (error) {
        return {
          success: false,
          error: `Execution error: ${error.message}`,
        };
      } finally {
        if (context) context.dispose();
        if (runtime) runtime.dispose();
      }
    },

    /**
     * Dispose of resources (each execution disposes its own QuickJS runtime)
     */
    dispose() {},
  };
}

module.exports = {
  createSandbox,
  validateSQL,
  validateJS,
};
