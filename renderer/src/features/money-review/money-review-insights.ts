import type { MoneyReviewItem } from './types';

export interface MoneyReviewComparison {
  firstLabel: string;
  firstValue: number;
  secondLabel: string;
  secondValue: number;
  format: 'currency' | 'number';
}

export interface MoneyReviewMetric {
  label: string;
  value: number | string;
  format?: 'currency' | 'number' | 'text';
}

export interface MoneyReviewInsight {
  explanation: string;
  comparison: MoneyReviewComparison | null;
  metrics: MoneyReviewMetric[];
  source: string;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function metric(
  label: string,
  value: unknown,
  format: MoneyReviewMetric['format'] = 'number',
): MoneyReviewMetric | null {
  if (format === 'text') {
    return typeof value === 'string' && value.trim() ? { label, value, format } : null;
  }
  const parsed = finite(value);
  return parsed === null ? null : { label, value: parsed, format };
}

export function buildMoneyReviewInsight(item: MoneyReviewItem): MoneyReviewInsight {
  const metadata = record(item.metadata);
  const data = record(metadata.data);
  const notificationType = String(metadata.notificationType || '');
  const metrics: Array<MoneyReviewMetric | null> = [];
  let comparison: MoneyReviewComparison | null = null;
  let explanation = `detail.explanations.${item.group}`;

  if (['budget_warning', 'budget_exceeded', 'budget_projected'].includes(notificationType)) {
    const projected = finite(data.projected_total ?? data.projectedTotal);
    const spent = finite(data.spent);
    const limit = finite(data.budget ?? data.limit);
    const observed = projected ?? spent;
    if (observed !== null && limit !== null) {
      comparison = {
        firstLabel: projected !== null ? 'detail.labels.projected' : 'detail.labels.spent',
        firstValue: observed,
        secondLabel: 'detail.labels.budget',
        secondValue: limit,
        format: 'currency',
      };
    }
    metrics.push(metric('detail.labels.category', data.category_name, 'text'));
    metrics.push(metric('detail.labels.overBudget', item.potentialImpact, 'currency'));
    explanation = 'detail.explanations.budget';
  } else if (metadata.source === 'subscription') {
    const previous = finite(data.old_amount);
    const current = finite(data.new_amount ?? data.detected_amount);
    if (previous !== null && current !== null) {
      comparison = {
        firstLabel: 'detail.labels.previousCharge',
        firstValue: previous,
        secondLabel: 'detail.labels.currentCharge',
        secondValue: current,
        format: 'currency',
      };
    }
    metrics.push(metric('detail.labels.change', data.percentage_change, 'number'));
    metrics.push(metric('detail.labels.frequency', data.detected_frequency, 'text'));
    explanation = 'detail.explanations.subscription';
  } else if (notificationType === 'cash_flow_alert') {
    const income = finite(data.income);
    const expenses = finite(data.expenses);
    if (income !== null && expenses !== null) {
      comparison = {
        firstLabel: 'detail.labels.income',
        firstValue: income,
        secondLabel: 'detail.labels.expenses',
        secondValue: expenses,
        format: 'currency',
      };
    }
    metrics.push(metric('detail.labels.daysRemaining', data.days_remaining));
    metrics.push(metric('detail.labels.dailySpending', data.daily_spending, 'currency'));
    explanation = 'detail.explanations.cashFlow';
  } else if (notificationType === 'stale_sync') {
    metrics.push(metric('detail.labels.accountsAffected', data.stale_count));
    metrics.push(metric('detail.labels.daysSinceSync', data.days_since_sync));
    metrics.push(metric('detail.labels.oldestAccount', data.oldest_account, 'text'));
    explanation = 'detail.explanations.staleSync';
  } else if (notificationType === 'uncategorized_transactions') {
    metrics.push(metric('detail.labels.transactions', data.count));
    metrics.push(metric('detail.labels.amount', data.total_amount, 'currency'));
    explanation = 'detail.explanations.uncategorized';
  } else if (['unusual_spending', 'high_transaction'].includes(notificationType)) {
    metrics.push(metric('detail.labels.amount', data.amount, 'currency'));
    metrics.push(metric('detail.labels.vendor', data.vendor, 'text'));
    metrics.push(metric('detail.labels.category', data.category_name, 'text'));
    metrics.push(metric('detail.labels.deviation', data.deviation, 'number'));
    explanation = notificationType === 'unusual_spending'
      ? 'detail.explanations.unusual'
      : 'detail.explanations.largeTransaction';
  } else if (notificationType === 'new_vendor') {
    metrics.push(metric('detail.labels.transactions', data.transaction_count));
    metrics.push(metric('detail.labels.amount', data.total_amount, 'currency'));
    metrics.push(metric('detail.labels.vendor', data.vendor, 'text'));
    explanation = 'detail.explanations.newVendor';
  } else if (item.source === 'optimizerV2') {
    metrics.push(metric('detail.labels.scope', metadata.scope, 'text'));
    metrics.push(metric('detail.labels.monthlyPotential', item.potentialImpact, 'currency'));
    explanation = 'detail.explanations.optimizer';
  }

  return {
    explanation,
    comparison,
    metrics: metrics.filter((entry): entry is MoneyReviewMetric => Boolean(entry)),
    source: item.source === 'optimizerV2'
      ? 'detail.sources.optimizer'
      : item.source === 'subscription'
        ? 'detail.sources.subscription'
        : 'detail.sources.local',
  };
}
