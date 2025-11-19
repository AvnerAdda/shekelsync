module.exports = function resolveBetterSqlite() {
  if (process.env.BETTER_SQLITE3_STUB === 'true') {
    class MockBetterSqlite {
      constructor() {
        this.closed = false;
      }
      prepare() {
        return {
          all: () => [],
          run: () => ({ changes: 0 }),
        };
      }
      pragma() {
        return null;
      }
      exec() {
        return null;
      }
      close() {
        this.closed = true;
      }
    }
    return { default: MockBetterSqlite };
  }
  return require('better-sqlite3');
};

module.exports.default = module.exports;
