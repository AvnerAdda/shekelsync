import type { CorrectionAction, CorrectionTarget } from '@renderer/features/financial-truth/types';
import type { MoneyReviewItem } from './types';

const PATTERN_CAPABILITIES: CorrectionAction[] = [
  'suppress_pattern',
  'end_pattern',
  'pause_pattern',
  'override_pattern',
];

const ALLOWED_CAPABILITIES = new Set<CorrectionAction>([
  'skip_occurrence',
  ...PATTERN_CAPABILITIES,
  'set_category_expectation',
]);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function finiteAmount(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return undefined;
}

function nonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function capabilitiesFrom(...values: unknown[]): CorrectionAction[] {
  for (const value of values) {
    if (!Array.isArray(value)) continue;
    const capabilities = value.filter((entry): entry is CorrectionAction => (
      typeof entry === 'string' && ALLOWED_CAPABILITIES.has(entry as CorrectionAction)
    ));
    if (capabilities.length > 0) return [...new Set(capabilities)];
  }
  return [];
}

export function buildMoneyReviewCorrectionTarget(item: MoneyReviewItem): CorrectionTarget | null {
  const metadata = record(item.metadata);
  const data = record(metadata.data);
  const patternId = positiveInteger(metadata.patternId ?? metadata.pattern_id);
  const categoryDefinitionId = positiveInteger(
    data.category_definition_id ?? data.categoryDefinitionId ?? metadata.categoryDefinitionId,
  );
  const occurrenceId = nonEmptyString(
    metadata.occurrenceId,
    metadata.occurrence_id,
    data.occurrenceId,
    data.occurrence_id,
  );
  const declaredCapabilities = capabilitiesFrom(
    metadata.correctionCapabilities,
    metadata.correction_capabilities,
    data.correctionCapabilities,
    data.correction_capabilities,
  );

  if (patternId) {
    const capabilities = declaredCapabilities.length > 0
      ? declaredCapabilities.filter((capability) => capability !== 'set_category_expectation')
      : [...PATTERN_CAPABILITIES];
    if (occurrenceId && !capabilities.includes('skip_occurrence')) {
      capabilities.unshift('skip_occurrence');
    }

    return {
      kind: occurrenceId ? 'occurrence' : 'pattern',
      patternId,
      occurrenceId,
      title: item.title,
      amount: finiteAmount(
        data.new_amount,
        data.newAmount,
        data.detected_amount,
        data.detectedAmount,
        data.expected_amount,
        data.expectedAmount,
        data.amount,
      ),
      frequency: nonEmptyString(
        data.user_frequency,
        data.userFrequency,
        data.detected_frequency,
        data.detectedFrequency,
        data.frequency,
      ),
      nextExpectedDate: nonEmptyString(
        data.next_expected_date,
        data.nextExpectedDate,
        data.expected_date,
        data.expectedDate,
      ),
      capabilities,
    };
  }

  const notificationType = String(metadata.notificationType || '');
  const supportsCategoryExpectation = declaredCapabilities.includes('set_category_expectation')
    || notificationType === 'budget_projected';
  if (!categoryDefinitionId || !supportsCategoryExpectation) return null;

  return {
    kind: 'category',
    categoryDefinitionId,
    title: item.title,
    amount: finiteAmount(
      data.projected_total,
      data.projectedTotal,
      data.monthly_amount,
      data.monthlyAmount,
      data.expected_amount,
      data.expectedAmount,
      data.spent,
    ),
    capabilities: ['set_category_expectation'],
  };
}

