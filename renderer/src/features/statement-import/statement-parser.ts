/**
 * Turns a bank / credit-card statement export (CSV, XLSX, XLS, or the
 * HTML-table ".xls" some banks produce) into rows the server can import.
 *
 * Parsing runs here, in the sandboxed renderer, so a malformed file can't
 * reach the privileged main process. SheetJS is loaded only when a file is
 * opened.
 */

export type CellValue = string | number | boolean | null;

export interface StatementSheet {
  name: string;
  rows: CellValue[][];
}

export type ColumnRole =
  | 'date'
  | 'processedDate'
  | 'description'
  | 'amount'
  | 'debit'
  | 'credit'
  | 'originalAmount'
  | 'originalCurrency'
  | 'memo';

export type ColumnMapping = Record<ColumnRole, number | null>;

export interface StatementRow {
  date: string;
  processedDate?: string;
  description: string;
  amount: number;
  originalAmount?: number;
  originalCurrency?: string;
  memo?: string;
}

export interface BuildRowsOptions {
  /** Card statements list a purchase as a positive number; the ledger stores spending as negative. */
  chargesArePositive: boolean;
}

export interface BuildRowsResult {
  rows: StatementRow[];
  /** Data rows with no readable date: totals, section titles, notes. */
  skipped: number;
}

export const COLUMN_ROLES: ColumnRole[] = [
  'date',
  'description',
  'amount',
  'debit',
  'credit',
  'processedDate',
  'originalAmount',
  'originalCurrency',
  'memo',
];

export const EMPTY_MAPPING: ColumnMapping = {
  date: null,
  processedDate: null,
  description: null,
  amount: null,
  debit: null,
  credit: null,
  originalAmount: null,
  originalCurrency: null,
  memo: null,
};

const HEADER_SCAN_ROWS = 40;
const MAX_FILE_BYTES = 15 * 1024 * 1024;

// ---------- file reading ----------

function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
  } catch {
    // Older Israeli exports are Windows-1255 (Hebrew ANSI).
    return new TextDecoder('windows-1255').decode(bytes);
  }
}

function looksLikeText(bytes: Uint8Array, fileName: string): boolean {
  if (/\.(csv|txt|tsv)$/i.test(fileName)) return true;
  // Some banks save an HTML table with an .xls extension.
  for (let i = 0; i < Math.min(bytes.length, 512); i += 1) {
    const byte = bytes[i];
    if (byte === 0xef || byte === 0xbb || byte === 0xbf || byte <= 0x20) continue;
    return byte === 0x3c; // '<'
  }
  return false;
}

export class StatementFileError extends Error {
  constructor(public readonly code: 'too_large' | 'unreadable' | 'empty') {
    super(code);
    this.name = 'StatementFileError';
  }
}

export async function readStatementFile(file: File): Promise<StatementSheet[]> {
  if (file.size > MAX_FILE_BYTES) {
    throw new StatementFileError('too_large');
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const XLSX = await import('xlsx');

  let workbook;
  try {
    workbook = looksLikeText(bytes, file.name)
      // raw: keep "15/03/2026" and "1,234.50" as text; this module parses them
      // with Israeli conventions instead of SheetJS guessing US dates.
      ? XLSX.read(decodeText(bytes), { type: 'string', raw: true, dense: true })
      : XLSX.read(bytes, { type: 'array', dense: true });
  } catch {
    throw new StatementFileError('unreadable');
  }

  const sheets: StatementSheet[] = workbook.SheetNames.map((name) => ({
    name,
    rows: (XLSX.utils.sheet_to_json<CellValue[]>(workbook.Sheets[name], {
      header: 1,
      raw: true,
      defval: null,
      blankrows: false,
    }) || []).map((row) => (Array.isArray(row) ? row : [])),
  })).filter((sheet) => sheet.rows.length > 0);

  if (sheets.length === 0) {
    throw new StatementFileError('empty');
  }
  return sheets;
}

// ---------- header + column detection ----------

function normalizeHeader(value: CellValue): string {
  return String(value ?? '')
    .replace(/[\u200e\u200f\u202a-\u202e]/g, '')
    .replace(/["'״׳()₪:*.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

interface RoleRule {
  exact: string[];
  contains: string[];
  exclude?: string[];
}

// Header names seen in Israeli bank and card exports, plus common English ones.
const ROLE_RULES: Record<ColumnRole, RoleRule> = {
  date: {
    exact: ['תאריך', 'תאריך עסקה', 'תאריך רכישה', 'תאריך התנועה', 'date', 'transaction date'],
    contains: ['תאריך עסקה', 'תאריך רכישה', 'transaction date', 'purchase date'],
    exclude: ['חיוב', 'ערך', 'value', 'charge', 'billing'],
  },
  processedDate: {
    exact: ['תאריך חיוב', 'מועד חיוב', 'charge date', 'billing date'],
    contains: ['תאריך חיוב', 'מועד חיוב', 'charge date', 'billing date'],
  },
  description: {
    exact: ['שם בית העסק', 'שם בית עסק', 'בית עסק', 'תיאור', 'תיאור הפעולה', 'תיאור התנועה', 'description', 'merchant', 'payee'],
    contains: ['בית העסק', 'בית עסק', 'תיאור', 'description', 'merchant', 'פרטים', 'סוג תנועה', 'details'],
  },
  amount: {
    exact: ['סכום חיוב', 'סכום החיוב', 'סכום לחיוב', 'זכות/חובה', 'סכום', 'amount', 'charged amount'],
    contains: ['סכום חיוב', 'סכום החיוב', 'סכום לחיוב', 'זכות/חובה', 'charged amount', 'amount'],
    exclude: ['מקורי', 'original', 'יתרה', 'balance'],
  },
  originalAmount: {
    exact: ['סכום עסקה מקורי', 'סכום עסקה', 'סכום מקורי', 'original amount'],
    contains: ['סכום עסקה', 'סכום מקורי', 'original amount'],
  },
  originalCurrency: {
    exact: ['מטבע עסקה מקורי', 'מטבע מקור', 'מטבע עסקה', 'מטבע', 'currency', 'original currency'],
    contains: ['מטבע מקור', 'מטבע עסקה', 'original currency'],
    exclude: ['חיוב'],
  },
  debit: {
    exact: ['חובה', 'בחובה', 'debit', 'withdrawal', 'withdrawals'],
    contains: ['בחובה', 'debit', 'withdrawal'],
    exclude: ['זכות'],
  },
  credit: {
    exact: ['זכות', 'בזכות', 'credit', 'deposit', 'deposits'],
    contains: ['בזכות', 'credit', 'deposit'],
    exclude: ['חובה'],
  },
  memo: {
    exact: ['פירוט נוסף', 'הערות', 'הערה', 'notes', 'memo'],
    contains: ['פירוט נוסף', 'הערות', 'notes', 'memo'],
  },
};

function roleScore(role: ColumnRole, header: string): number {
  if (!header) return 0;
  const rule = ROLE_RULES[role];
  if (rule.exact.includes(header)) return 3;
  if (rule.exclude?.some((word) => header.includes(word))) return 0;
  return rule.contains.some((word) => header.includes(word)) ? 2 : 0;
}

function anyRoleScore(header: string): number {
  return COLUMN_ROLES.reduce((best, role) => Math.max(best, roleScore(role, header)), 0);
}

/** The header row is the early row that names the most known columns, and must name a date. */
export function detectHeaderRow(rows: CellValue[][]): number {
  let bestIndex = -1;
  let bestHits = 1;
  rows.slice(0, HEADER_SCAN_ROWS).forEach((row, index) => {
    const headers = row.map(normalizeHeader);
    const hits = headers.filter((header) => anyRoleScore(header) > 0).length;
    const hasDate = headers.some((header) => roleScore('date', header) > 0 || roleScore('processedDate', header) > 0);
    if (hasDate && hits > bestHits) {
      bestHits = hits;
      bestIndex = index;
    }
  });
  return bestIndex;
}

export function guessColumnMapping(headerRow: CellValue[]): ColumnMapping {
  const headers = headerRow.map(normalizeHeader);
  const mapping: ColumnMapping = { ...EMPTY_MAPPING };
  const used = new Set<number>();

  // Order matters: claim the specific columns before the generic ones
  // ("סכום עסקה מקורי" must not become the charged amount).
  const order: ColumnRole[] = [
    'processedDate',
    'date',
    'originalAmount',
    'originalCurrency',
    'amount',
    'debit',
    'credit',
    'memo',
    'description',
  ];
  for (const role of order) {
    let best = { index: -1, score: 0 };
    headers.forEach((header, index) => {
      if (used.has(index)) return;
      const score = roleScore(role, header);
      if (score > best.score) best = { index, score };
    });
    if (best.index >= 0) {
      mapping[role] = best.index;
      used.add(best.index);
    }
  }

  // A file with only "סכום עסקה" (no charged-amount column) charges that amount.
  if (mapping.amount === null && mapping.debit === null && mapping.credit === null && mapping.originalAmount !== null) {
    mapping.amount = mapping.originalAmount;
    mapping.originalAmount = null;
  }
  // Debit/credit columns replace a single amount column.
  if (mapping.debit !== null && mapping.credit !== null && mapping.amount !== null
    && roleScore('amount', headers[mapping.amount]) < 3) {
    mapping.amount = null;
  }
  return mapping;
}

// ---------- cell parsing ----------

const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function toYmd(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Day-first (Israeli) dates, Excel serial numbers, yyyymmdd numbers and ISO dates. */
export function parseDateCell(value: CellValue): string | null {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;

  if (typeof value === 'number') {
    if (value >= 19000101 && value <= 21001231 && Number.isInteger(value)) {
      const text = String(value);
      return toYmd(Number(text.slice(0, 4)), Number(text.slice(4, 6)), Number(text.slice(6, 8)));
    }
    if (value > 20000 && value < 80000) {
      const date = new Date(EXCEL_EPOCH_UTC + Math.floor(value) * 86400000);
      return toYmd(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
    }
    return null;
  }

  const text = String(value).replace(/[\u200e\u200f\u202a-\u202e]/g, '').trim();
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(text);
  if (match) return toYmd(Number(match[1]), Number(match[2]), Number(match[3]));

  match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})(?:\s.*)?$/.exec(text);
  if (match) {
    let year = Number(match[3]);
    if (match[3].length === 2) year += year < 70 ? 2000 : 1900;
    return toYmd(year, Number(match[2]), Number(match[1]));
  }

  if (/^\d+(\.\d+)?$/.test(text)) {
    return parseDateCell(Number(text));
  }
  return null;
}

/** "1,234.50", "₪ 1,234.50", "-1,234.50", "1,234.50-", "(1,234.50)", and a Unicode minus sign. */
export function parseAmountCell(value: CellValue): number | null {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  let text = String(value).replace(/[\u200e\u200f\u202a-\u202e\s]/g, '').replace(/\u2212/g, '-');
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  if (text.endsWith('-')) {
    negative = !negative;
    text = text.slice(0, -1);
  }
  text = text.replace(/[^\d.,-]/g, '');
  if (text.startsWith('-')) {
    negative = !negative;
    text = text.slice(1);
  }
  text = text.replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const parsed = Number(text);
  return negative ? -parsed : parsed;
}

function cellText(value: CellValue): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[\u200e\u200f\u202a-\u202e]/g, '').replace(/\s+/g, ' ').trim();
}

function cellAt(row: CellValue[], index: number | null): CellValue {
  return index === null || index < 0 ? null : row[index] ?? null;
}

export function buildStatementRows(
  rows: CellValue[][],
  headerRowIndex: number,
  mapping: ColumnMapping,
  { chargesArePositive }: BuildRowsOptions,
): BuildRowsResult {
  const result: StatementRow[] = [];
  let skipped = 0;
  const usesDebitCredit = mapping.amount === null && (mapping.debit !== null || mapping.credit !== null);

  for (const row of rows.slice(headerRowIndex + 1)) {
    if (!row.some((cell) => cellText(cell) !== '')) continue;

    const date = parseDateCell(cellAt(row, mapping.date));
    if (!date) {
      skipped += 1;
      continue;
    }

    let amount: number | null;
    if (usesDebitCredit) {
      const debit = parseAmountCell(cellAt(row, mapping.debit));
      const credit = parseAmountCell(cellAt(row, mapping.credit));
      amount = debit === null && credit === null ? null : (credit ?? 0) - Math.abs(debit ?? 0);
    } else {
      const raw = parseAmountCell(cellAt(row, mapping.amount));
      amount = raw === null ? null : chargesArePositive ? -raw : raw;
    }

    const entry: StatementRow = {
      date,
      description: cellText(cellAt(row, mapping.description)),
      amount: amount === null ? Number.NaN : Math.round(amount * 100) / 100,
    };

    const processedDate = parseDateCell(cellAt(row, mapping.processedDate));
    if (processedDate) entry.processedDate = processedDate;

    const original = parseAmountCell(cellAt(row, mapping.originalAmount));
    if (original !== null && amount !== null && amount !== 0) {
      // Same direction as the charged amount; exports often list it unsigned.
      entry.originalAmount = Math.sign(amount) * Math.abs(original);
    }
    const currency = cellText(cellAt(row, mapping.originalCurrency));
    if (currency) entry.originalCurrency = currency;
    const memo = cellText(cellAt(row, mapping.memo));
    if (memo) entry.memo = memo;

    result.push(entry);
  }

  return { rows: result, skipped };
}

export function headerLabels(rows: CellValue[][], headerRowIndex: number): string[] {
  const header = headerRowIndex >= 0 ? rows[headerRowIndex] || [] : [];
  const width = Math.max(header.length, ...rows.slice(headerRowIndex + 1, headerRowIndex + 20).map((row) => row.length));
  return Array.from({ length: width }, (_, index) => cellText(header[index]) || `#${index + 1}`);
}
