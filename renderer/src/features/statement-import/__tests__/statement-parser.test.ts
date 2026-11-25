import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  buildStatementRows,
  detectHeaderRow,
  guessColumnMapping,
  headerLabels,
  parseAmountCell,
  parseDateCell,
  readStatementFile,
  StatementFileError,
} from '../statement-parser';

// Synthetic statement layouts modelled on common Israeli exports. No real data.
const CARD_SHEET = [
  ['פירוט עסקאות לכרטיס המסתיים ב-0000'],
  [null],
  ['תאריך עסקה', 'שם בית העסק', 'קטגוריה', 'סכום עסקה מקורי', 'מטבע עסקה מקורי', 'סכום חיוב', 'מטבע חיוב', 'תאריך חיוב', 'פירוט נוסף'],
  ['05/03/2026', 'סופר לדוגמה', 'מזון', 120.5, '₪', 120.5, '₪', '10/04/2026', null],
  ['12/03/2026', 'ONLINE SHOP', 'קניות', 25, '$', 95.3, '₪', '10/04/2026', null],
  ['20/03/2026', 'חנות אלקטרוניקה', 'קניות', 1500, '₪', 250, '₪', '10/04/2026', 'תשלום 2 מתוך 6'],
  ['22/03/2026', 'החזר מוצר', 'קניות', -40, '₪', -40, '₪', '10/04/2026', null],
  [null, 'סה"כ', null, null, null, 425.8, null, null, null],
];

const BANK_SHEET = [
  ['תנועות בחשבון 00-000-000000'],
  ['תאריך', 'תיאור הפעולה', 'פרטים', 'אסמכתא', 'חובה', 'זכות', 'יתרה בש"ח', 'תאריך ערך'],
  [46082, 'משכורת', 'חברה בע"מ', 1001, null, '10,000.00', '15,000.00', 46082],
  [46083, 'הוראת קבע', 'ועד בית', 1002, '250.00', null, '14,750.00', 46083],
];

describe('statement parser', () => {
  describe('parseDateCell', () => {
    it.each([
      ['05/03/2026', '2026-03-05'],
      ['5.3.26', '2026-03-05'],
      ['31-12-2025', '2025-12-31'],
      ['2026-03-05', '2026-03-05'],
      ['2026-03-05T00:00:00', '2026-03-05'],
      ['\u200f05/03/2026 14:22', '2026-03-05'],
      [46086, '2026-03-05'],
      [20260305, '2026-03-05'],
    ])('reads %s', (input, expected) => {
      expect(parseDateCell(input as any)).toBe(expected);
    });

    it.each(['31/02/2026', 'סה"כ', '', null, 12, '13/13/2026'])('rejects %s', (input) => {
      expect(parseDateCell(input as any)).toBeNull();
    });
  });

  describe('parseAmountCell', () => {
    it.each([
      ['1,234.50', 1234.5],
      ['₪ 1,234.50', 1234.5],
      ['-1,234.50', -1234.5],
      ['1,234.50-', -1234.5],
      ['(1,234.50)', -1234.5],
      ['\u2212 12', -12],
      ['12 ש"ח', 12],
      [42, 42],
    ])('reads %s', (input, expected) => {
      expect(parseAmountCell(input as any)).toBe(expected);
    });

    it.each(['', 'abc', null, '1.2.3'])('rejects %s', (input) => {
      expect(parseAmountCell(input as any)).toBeNull();
    });
  });

  it('finds the card header below the title rows and maps charged vs original amounts', () => {
    const headerRow = detectHeaderRow(CARD_SHEET);
    expect(headerRow).toBe(2);
    const mapping = guessColumnMapping(CARD_SHEET[headerRow]);
    expect(mapping).toEqual({
      date: 0,
      description: 1,
      originalAmount: 3,
      originalCurrency: 4,
      amount: 5,
      processedDate: 7,
      memo: 8,
      debit: null,
      credit: null,
    });

    const { rows, skipped } = buildStatementRows(CARD_SHEET, headerRow, mapping, { chargesArePositive: true });
    expect(skipped).toBe(1); // the totals row
    expect(rows).toEqual([
      { date: '2026-03-05', processedDate: '2026-04-10', description: 'סופר לדוגמה', amount: -120.5, originalAmount: -120.5, originalCurrency: '₪' },
      { date: '2026-03-12', processedDate: '2026-04-10', description: 'ONLINE SHOP', amount: -95.3, originalAmount: -25, originalCurrency: '$' },
      {
        date: '2026-03-20', processedDate: '2026-04-10', description: 'חנות אלקטרוניקה', amount: -250,
        originalAmount: -1500, originalCurrency: '₪', memo: 'תשלום 2 מתוך 6',
      },
      { date: '2026-03-22', processedDate: '2026-04-10', description: 'החזר מוצר', amount: 40, originalAmount: 40, originalCurrency: '₪' },
    ]);
  });

  it('combines bank debit and credit columns and ignores the balance column', () => {
    const headerRow = detectHeaderRow(BANK_SHEET);
    expect(headerRow).toBe(1);
    const mapping = guessColumnMapping(BANK_SHEET[headerRow]);
    expect(mapping).toMatchObject({ date: 0, description: 1, debit: 4, credit: 5, amount: null });

    const { rows } = buildStatementRows(BANK_SHEET, headerRow, mapping, { chargesArePositive: true });
    expect(rows).toEqual([
      { date: '2026-03-01', description: 'משכורת', amount: 10000 },
      { date: '2026-03-02', description: 'הוראת קבע', amount: -250 },
    ]);
  });

  it('keeps a signed single amount column as is for banks', () => {
    const sheet = [
      ['תאריך', 'תיאור התנועה', '₪ זכות/חובה', '₪ יתרה'],
      ['01/03/2026', 'העברה', '-300.00', '700.00'],
      ['02/03/2026', 'הפקדה', '1,000.00', '1,700.00'],
    ];
    const mapping = guessColumnMapping(sheet[0]);
    expect(mapping).toMatchObject({ date: 0, description: 1, amount: 2, debit: null, credit: null });
    const { rows } = buildStatementRows(sheet, 0, mapping, { chargesArePositive: false });
    expect(rows.map((row) => row.amount)).toEqual([-300, 1000]);
  });

  it('labels unnamed columns so they can still be picked', () => {
    expect(headerLabels([['תאריך', null, 'סכום'], ['01/03/2026', 'x', 5, 'extra']], 0)).toEqual(['תאריך', '#2', 'סכום', '#4']);
  });

  it('reads a Windows-1255 CSV export', async () => {
    const encoder = new Map<string, number>([['ת', 0xfa], ['א', 0xe0], ['ר', 0xf8], ['י', 0xe9], ['ך', 0xea], ['ס', 0xf1], ['כ', 0xeb], ['ו', 0xe5], ['ם', 0xed], ['ב', 0xe1], ['ע', 0xf2], ['ק', 0xf7], ['ה', 0xe4], ['פ', 0xf4]]);
    const text = 'תאריך,בית עסק,סכום\r\n05/03/2026,קפה,"1,018.00"\r\n';
    const bytes = Uint8Array.from([...text].map((char) => encoder.get(char) ?? char.charCodeAt(0)));
    const sheets = await readStatementFile(new File([bytes], 'export.csv'));

    expect(sheets[0].rows).toEqual([
      ['תאריך', 'בית עסק', 'סכום'],
      ['05/03/2026', 'קפה', '1,018.00'],
    ]);
  });

  it('reads an XLSX workbook', async () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(CARD_SHEET), 'עסקאות');
    const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
    const sheets = await readStatementFile(new File([bytes], 'export.xlsx'));

    expect(sheets).toHaveLength(1);
    expect(sheets[0].name).toBe('עסקאות');
    // Blank rows are dropped, so the header moves up one row.
    expect(detectHeaderRow(sheets[0].rows)).toBe(1);
    expect(sheets[0].rows[2]).toEqual(['05/03/2026', 'סופר לדוגמה', 'מזון', 120.5, '₪', 120.5, '₪', '10/04/2026', null]);
  });

  it('rejects files that are too large', async () => {
    const huge = new File([new Uint8Array(1)], 'huge.xlsx');
    Object.defineProperty(huge, 'size', { value: 16 * 1024 * 1024 });
    await expect(readStatementFile(huge)).rejects.toBeInstanceOf(StatementFileError);
  });
});
