const CURRENCY_PREFIX_PATTERN = /(?:₪|\b(?:ILS|NIS))\s*-?\d(?:[\d,.]*\d)?/gi;
const CURRENCY_SUFFIX_PATTERN = /-?\d(?:[\d,.]*\d)?\s*(?:₪|(?:ILS|NIS)\b)/gi;
const STANDALONE_NUMBER_PATTERN = /-?\d(?:[\d,.]*\d)?/g;

/**
 * Masks figures embedded in generated financial prose. Currency tokens are
 * retained where possible, while unlabelled figures are also obscured because
 * model-generated text does not consistently include a currency marker.
 */
export function maskFinancialText(value: string): string {
  return value
    .replace(CURRENCY_PREFIX_PATTERN, (match) => {
      const currency = match.match(/₪|ILS|NIS/i)?.[0] || '';
      return currency === '₪' ? '₪***' : `${currency.toUpperCase()} ***`;
    })
    .replace(CURRENCY_SUFFIX_PATTERN, (match) => {
      const currency = match.match(/₪|ILS|NIS/i)?.[0] || '';
      return currency === '₪' ? '*** ₪' : `*** ${currency.toUpperCase()}`;
    })
    .replace(STANDALONE_NUMBER_PATTERN, '***');
}
