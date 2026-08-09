/**
 * Shared operating/gross cash-flow helpers for dashboard charts.
 *
 * The operating split exists to strip credit-card repayment double counting,
 * which only occurs when card transactions are actually paired with their
 * repayments. For bank-feed-only users (no paired card data) the repayment
 * debits ARE the visible spending, so the truthful basis is gross — the same
 * behavior the dashboard had before the operating split was introduced.
 */

export function preferOperatingNumber(operating: unknown, gross: unknown): number {
  if (operating !== undefined && operating !== null) {
    const value = Number(operating);
    if (Number.isFinite(value)) {
      return value;
    }
  }
  const fallback = Number(gross);
  return Number.isFinite(fallback) ? fallback : 0;
}

export function grossNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function hasPairedCardData(
  history: ReadonlyArray<{ pairedCardRepayments?: number | null }> | null | undefined,
): boolean {
  return (history || []).some((day) => grossNumber(day?.pairedCardRepayments) > 0);
}
