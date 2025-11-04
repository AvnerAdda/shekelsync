const useSqlite =
  process.env.USE_SQLITE === 'true' ||
  process.env.USE_SQLCIPHER === 'true' ||
  Boolean(process.env.SQLITE_DB_PATH) ||
  Boolean(process.env.SQLCIPHER_DB_PATH);

const dialect = {
  useSqlite,

  dateTrunc(unit, column) {
    if (!useSqlite) {
      return `DATE_TRUNC('${unit}', ${column})`;
    }
    const map = {
      day: `date(${column})`,
      week: `date(${column}, 'weekday 0', '-6 days')`,
      month: `date(${column}, 'start of month')`,
      year: `date(${column}, 'start of year')`,
    };
    return map[unit] || `date(${column})`;
  },

  toChar(column, format) {
    if (!useSqlite) {
      return `TO_CHAR(${column}, '${format}')`;
    }
    let converted = format;
    converted = converted.replace(/YYYY/g, '%Y');
    converted = converted.replace(/YY/g, '%y');
    converted = converted.replace(/MM/g, '%m');
    converted = converted.replace(/DD/g, '%d');
    converted = converted.replace(/HH24/g, '%H');
    converted = converted.replace(/MI/g, '%M');
    converted = converted.replace(/SS/g, '%S');
    converted = converted.replace(/Mon/g, '%b');
    converted = converted.replace(/WW/g, '%W');
    return `strftime('${converted}', ${column})`;
  },

  extract(part, column) {
    if (!useSqlite) {
      return `EXTRACT(${part.toUpperCase()} FROM ${column})`;
    }
    const lower = part.toLowerCase();
    if (lower === 'dow') {
      return `CAST(strftime('%w', ${column}) AS INTEGER)`;
    }
    if (lower === 'hour') {
      return `CAST(strftime('%H', ${column}) AS INTEGER)`;
    }
    if (lower === 'day') {
      return `CAST(strftime('%d', ${column}) AS INTEGER)`;
    }
    if (lower === 'month') {
      return `CAST(strftime('%m', ${column}) AS INTEGER)`;
    }
    if (lower === 'year') {
      return `CAST(strftime('%Y', ${column}) AS INTEGER)`;
    }
    return `CAST(strftime('%${lower[0]}', ${column}) AS INTEGER)`;
  },

  castNumeric(column) {
    if (!useSqlite) {
      return `${column}::numeric`;
    }
    return `CAST(${column} AS REAL)`;
  },

  likeInsensitive(column, placeholder) {
    return `LOWER(${column}) LIKE LOWER(${placeholder})`;
  },
};

module.exports = { dialect, useSqlite };
module.exports.default = { dialect, useSqlite };
