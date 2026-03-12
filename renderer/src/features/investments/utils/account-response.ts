export function getCreatedInvestmentAccountId(payload: unknown): number | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const root = payload as Record<string, unknown>;
  const account =
    root.account && typeof root.account === 'object'
      ? (root.account as Record<string, unknown>)
      : root;

  const rawId = account.id;
  if (typeof rawId === 'number' && Number.isFinite(rawId)) {
    return rawId;
  }
  if (typeof rawId === 'string' && rawId.trim() !== '') {
    const parsed = Number.parseInt(rawId, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}
