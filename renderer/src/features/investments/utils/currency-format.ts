export function getCurrencyDisplaySymbol(currency?: string | null): string {
  const normalized = String(currency || 'ILS').trim().toUpperCase();
  if (normalized === 'ILS') return '₪';
  return normalized ? `${normalized} ` : '';
}
