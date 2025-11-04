export interface MatchResult {
  match: boolean;
  confidence: number;
  pattern?: string;
  matchType?: 'keyword' | 'pattern';
  matchCount?: number;
  matches?: Array<{
    transaction: unknown;
    pattern: string;
    confidence: number;
  }>;
  accountName?: string;
  accountType?: string;
}

export function normalizeText(text: string): string;
export function calculateSimilarity(str1: string, str2: string): number;
export function matchAccount(
  accountName: string,
  accountType: string,
  transactions?: Array<string | { name: string }>,
): MatchResult;
export function buildSQLPatterns(accountType: string): string[];
export function detectAccountType(accountName: string): string | null;
