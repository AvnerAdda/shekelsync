/**
 * Utilities for matching account names to transaction descriptions
 * Handles Hebrew, English, transliterations, and fuzzy matching
 */

import { getPatternsForType, getKeywordsForType, getAllPatterns } from '../config/investment-patterns.js';

/**
 * Normalize text for comparison
 * Handles Hebrew final forms, nikud, punctuation, and whitespace
 */
export function normalizeText(text) {
  if (!text) return '';
  
  return text
    .toLowerCase()
    .trim()
    // Normalize Hebrew final letter forms to regular forms
    .replace(/ם/g, 'מ')
    .replace(/ן/g, 'נ')
    .replace(/ץ/g, 'צ')
    .replace(/ף/g, 'פ')
    .replace(/ך/g, 'כ')
    // Remove Hebrew nikud (vowel marks)
    .replace(/[\u0591-\u05C7]/g, '')
    // Remove common abbreviation markers
    .replace(/"/g, '')
    .replace(/'/g, '')
    // Normalize punctuation and spaces
    .replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Check if two strings match with fuzzy logic
 * Returns confidence score 0-1
 */
export function calculateSimilarity(str1, str2) {
  const s1 = normalizeText(str1);
  const s2 = normalizeText(str2);
  
  if (!s1 || !s2) return 0;
  
  // Exact match after normalization
  if (s1 === s2) return 1.0;
  
  // One contains the other (very strong match)
  if (s1.includes(s2) || s2.includes(s1)) {
    const shorter = Math.min(s1.length, s2.length);
    const longer = Math.max(s1.length, s2.length);
    // Penalize if one is much longer than the other
    return 0.9 * (shorter / longer);
  }
  
  // Check word overlap
  const words1 = s1.split(' ');
  const words2 = s2.split(' ');
  const commonWords = words1.filter(w => words2.includes(w)).length;
  
  if (commonWords > 0) {
    const wordScore = commonWords / Math.max(words1.length, words2.length);
    if (wordScore > 0.5) return 0.7 + (wordScore * 0.2); // 0.7-0.9
  }
  
  // Levenshtein distance for close matches
  const distance = levenshteinDistance(s1, s2);
  const maxLen = Math.max(s1.length, s2.length);
  const similarity = 1 - (distance / maxLen);
  
  // Only return if similarity is decent
  return similarity > 0.6 ? similarity : 0;
}

/**
 * Levenshtein distance algorithm
 */
function levenshteinDistance(str1, str2) {
  const matrix = [];
  
  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }
  
  return matrix[str2.length][str1.length];
}

/**
 * Match an account name against transactions
 * Returns match info with confidence score
 *
 * @param {string} accountName - Account name to match
 * @param {string} accountType - Account type (savings, brokerage, etc.)
 * @param {Array} transactions - Optional list of transaction names to check against
 * @returns {Object} Match result with confidence and details
 */
export function matchAccount(accountName, accountType, transactions = null) {
  const normalizedAccountName = normalizeText(accountName);
  
  // Get patterns for this account type
  const patterns = getPatternsForType(accountType);
  const keywords = getKeywordsForType(accountType);
  
  // If no transactions provided, just check if account name matches patterns
  if (!transactions) {
    let bestMatch = { match: false, confidence: 0, pattern: null };
    
    // First check keywords (highest priority)
    for (const keyword of keywords) {
      const similarity = calculateSimilarity(normalizedAccountName, keyword);
      if (similarity > bestMatch.confidence) {
        bestMatch = {
          match: similarity > 0.5,
          confidence: similarity,
          pattern: keyword,
          matchType: 'keyword'
        };
      }
    }
    
    // If no good keyword match, check all patterns
    if (bestMatch.confidence < 0.7) {
      for (const pattern of patterns) {
        const similarity = calculateSimilarity(normalizedAccountName, pattern);
        if (similarity > bestMatch.confidence) {
          bestMatch = {
            match: similarity > 0.5,
            confidence: similarity,
            pattern: pattern,
            matchType: 'pattern'
          };
        }
      }
    }
    
    return bestMatch;
  }
  
  // If transactions provided, find matches
  const matches = [];
  
  for (const txn of transactions) {
    const txnName = typeof txn === 'string' ? txn : txn.name;
    
    // Check if transaction matches any pattern for this account type
    for (const pattern of patterns) {
      const similarity = calculateSimilarity(txnName, pattern);
      if (similarity > 0.5) {
        matches.push({
          transaction: txn,
          pattern: pattern,
          confidence: similarity
        });
        break; // Found a match, no need to check more patterns
      }
    }
  }
  
  // Sort by confidence
  matches.sort((a, b) => b.confidence - a.confidence);
  
  return {
    match: matches.length > 0,
    confidence: matches.length > 0 ? matches[0].confidence : 0,
    matchCount: matches.length,
    matches: matches,
    accountName: accountName,
    accountType: accountType
  };
}

/**
 * Build SQL LIKE patterns for database queries
 * @param {string} accountType - Account type
 * @returns {Array} Array of SQL LIKE patterns
 */
export function buildSQLPatterns(accountType) {
  const patterns = getPatternsForType(accountType);
  return patterns.map(p => `%${normalizeText(p)}%`);
}

/**
 * Detect account type from account name (best guess)
 * Useful when user hasn't selected type yet
 */
export function detectAccountType(accountName) {
  const normalized = normalizeText(accountName);
  let bestMatch = { type: null, confidence: 0 };

  const allPatterns = getAllPatterns();

  for (const { pattern, type } of allPatterns) {
    const similarity = calculateSimilarity(normalized, pattern);
    if (similarity > bestMatch.confidence) {
      bestMatch = { type, confidence: similarity };
    }
  }

  return bestMatch.confidence > 0.6 ? bestMatch.type : null;
}
