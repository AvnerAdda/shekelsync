const database = require('./database.js');
const notificationsService = require('./notifications.js');
const subscriptionsService = require('./analytics/subscriptions.js');
const financialTruthService = require('./financial-truth.js');
const forecastService = require('./forecast.js');

const REVIEW_NOTIFICATION_PREFIX = 'money_review:notification:';
const REVIEW_SUBSCRIPTION_PREFIX = 'money_review:subscription:';
const REVIEW_STATUSES = new Set(['active', 'accepted', 'snoozed', 'resolved', 'dismissed']);
const SNOOZE_DAYS = new Map([
  ['1_week', 7],
  ['1_month', 30],
  ['3_months', 90],
]);

const NOTIFICATION_ACTION_TYPES = {
  budget_warning: 'budget_overrun',
  budget_exceeded: 'budget_overrun',
  budget_projected: 'budget_overrun',
  unusual_spending: 'unusual_purchase',
  high_transaction: 'unusual_purchase',
  recurring_due: 'fixed_recurring_change',
  cash_flow_alert: 'seasonal_alert',
  new_vendor: 'anomaly',
  stale_sync: 'optimization_low_confidence',
  uncategorized_transactions: 'optimization_low_confidence',
  goal_milestone: 'quest_savings_target',
};

function serviceError(status, message, code) {
  const error = new Error(message);
  error.status = status;
  if (code) error.code = code;
  return error;
}

function parseJson(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function loadForecastAccuracy() {
  try {
    return forecastService.getForecastAccuracy({ days: 90 });
  } catch (error) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn('Money Review forecast calibration unavailable:', error?.message || error);
    }
    return null;
  }
}

function normalizeNotificationResponse(payload) {
  const items = payload?.data?.notifications ?? payload?.notifications ?? [];
  return Array.isArray(items) ? items : [];
}

function notificationImpact(notification) {
  const data = notification?.data || {};
  if (notification.type === 'budget_exceeded') {
    return Math.max(0, number(data.spent) - number(data.budget));
  }
  if (notification.type === 'budget_projected') {
    return Math.max(0, number(data.projected_total ?? data.projectedTotal) - number(data.budget ?? data.limit));
  }
  if (notification.type === 'cash_flow_alert') {
    return Math.max(0, Math.abs(number(data.projected_balance ?? data.projectedBalance)));
  }
  if (notification.type === 'recurring_due') {
    return Math.max(0, number(data.potential_impact));
  }
  return 0;
}

function severityForNotification(severity) {
  if (severity === 'critical') return 'critical';
  if (severity === 'warning') return 'high';
  return 'low';
}

function notificationToSmartAction(notification) {
  if (!notification?.actionable || !notification?.id) return null;
  const actionType = NOTIFICATION_ACTION_TYPES[notification.type];
  if (!actionType) return null;

  return {
    actionType,
    severity: severityForNotification(notification.severity),
    title: String(notification.title || 'Review your finances'),
    description: String(notification.message || ''),
    detectedAt: notification.timestamp || new Date().toISOString(),
    recurrenceKey: `${REVIEW_NOTIFICATION_PREFIX}${notification.type}:${notification.id}`,
    potentialImpact: notificationImpact(notification),
    confidence: notification.type === 'unusual_spending' ? 0.7 : 0.9,
    metadata: {
      source: notification.source || 'notification',
      notificationId: String(notification.id),
      notificationType: String(notification.type),
      notificationSeverity: String(notification.severity || 'info'),
      data: notification.data || {},
      timeScope: notification.data?.time_scope || null,
      patternId: notification.data?.patternId || notification.data?.pattern_id || null,
      occurrenceId: notification.data?.occurrenceId || notification.data?.occurrence_id || null,
      correctionCapabilities: notification.data?.correctionCapabilities
        || notification.data?.correction_capabilities
        || [],
      actions: Array.isArray(notification.actions) ? notification.actions : [],
    },
  };
}

function subscriptionAlertImpact(alert) {
  if (alert.alert_type === 'price_increase') {
    return Math.max(0, number(alert.new_amount) - number(alert.old_amount));
  }
  if (['duplicate', 'unused', 'cancelled_still_charging'].includes(alert.alert_type)) {
    return Math.max(0, number(alert.new_amount ?? alert.detected_amount));
  }
  return 0;
}

function subscriptionAlertToSmartAction(alert) {
  if (!alert?.subscription_id || !alert?.alert_type) return null;
  const evidenceDate = alert.evidence_end_date || alert.expected_date || null;
  const stableAlertId = alert.id
    || `${alert.subscription_id}:${alert.alert_type}${evidenceDate ? `:${evidenceDate}` : ''}`;
  const actionType = {
    duplicate: 'fixed_recurring_duplicate',
    missed_charge: 'fixed_recurring_missing',
  }[alert.alert_type] || 'fixed_recurring_change';

  return {
    actionType,
    severity: severityForNotification(alert.severity),
    title: String(alert.title || alert.subscription_name || 'Review subscription'),
    description: String(alert.description || ''),
    detectedAt: alert.created_at || new Date().toISOString(),
    recurrenceKey: `${REVIEW_SUBSCRIPTION_PREFIX}${stableAlertId}`,
    potentialImpact: subscriptionAlertImpact(alert),
    confidence: 0.9,
    metadata: {
      source: 'subscription',
      notificationType: 'recurring_due',
      subscriptionAlertId: alert.id || null,
      subscriptionId: alert.subscription_id,
      subscriptionAlertType: alert.alert_type,
      patternId: alert.financial_pattern_id || alert.patternId || null,
      occurrenceId: alert.occurrence_id || alert.occurrenceId || null,
      correctionCapabilities: alert.correction_capabilities
        || alert.correctionCapabilities
        || [],
      timeScope: alert.time_scope || null,
      data: {
        old_amount: alert.old_amount,
        new_amount: alert.new_amount,
        percentage_change: alert.percentage_change,
        detected_amount: alert.detected_amount,
        detected_frequency: alert.detected_frequency,
        evidence_start_date: alert.evidence_start_date || null,
        evidence_end_date: alert.evidence_end_date || null,
        expected_date: alert.expected_date || null,
        days_past_due: alert.days_past_due ?? null,
        occurrence_id: alert.occurrence_id || alert.occurrenceId || null,
        correction_capabilities: alert.correction_capabilities
          || alert.correctionCapabilities
          || [],
        time_scope: alert.time_scope || null,
      },
      actions: [{ action: 'view_subscriptions', params: { subscription_id: alert.subscription_id } }],
    },
  };
}

function resolveGroup(row, metadata) {
  const notificationType = metadata.notificationType;
  if (['stale_sync', 'uncategorized_transactions', 'new_vendor'].includes(notificationType)) {
    return 'data';
  }
  if (
    ['budget_warning', 'budget_exceeded', 'budget_projected', 'unusual_spending',
      'high_transaction', 'recurring_due', 'cash_flow_alert'].includes(notificationType)
    || ['budget_overrun', 'unusual_purchase', 'seasonal_alert', 'fixed_recurring_change',
      'fixed_recurring_missing', 'fixed_recurring_duplicate'].includes(row.action_type)
  ) {
    return 'cash';
  }
  return 'improve';
}

function resolvePrimaryAction(row, metadata) {
  const actions = Array.isArray(metadata.actions) ? metadata.actions : [];
  if (actions[0]?.action) return actions[0];
  if (metadata.source === 'optimizerV2' || row.action_type.startsWith('optimization')) {
    return { label: 'Open optimizer', action: 'open_optimizer', params: {} };
  }
  if (row.action_type.startsWith('quest_')) {
    return row.user_status === 'active'
      ? { label: 'Accept challenge', action: 'accept_quest', params: { quest_id: row.id } }
      : { label: 'View challenge', action: 'view_quests', params: { quest_id: row.id } };
  }
  return null;
}

function priorityForRow(row, group) {
  const severityScore = {
    critical: 90,
    high: 72,
    medium: 55,
    low: 35,
  }[row.severity] || 35;
  const impactBonus = Math.min(15, Math.log10(Math.max(1, number(row.potential_impact))) * 4);
  const confidenceBonus = number(row.detection_confidence, 0.5) * 8;
  const groupBonus = group === 'data' ? 7 : 0;
  return Math.round(Math.min(100, severityScore + impactBonus + confidenceBonus + groupBonus));
}

function normalizeReviewRow(row) {
  const metadata = parseJson(row.metadata, {});
  const group = resolveGroup(row, metadata);
  return {
    id: number(row.id),
    source: metadata.source || (String(row.recurrence_key || '').startsWith(REVIEW_NOTIFICATION_PREFIX) ? 'notification' : 'smart_action'),
    sourceKey: row.recurrence_key || `smart_action:${row.id}`,
    group,
    actionType: row.action_type,
    severity: row.severity,
    title: row.title,
    description: row.description || '',
    status: row.user_status,
    detectedAt: row.detected_at,
    updatedAt: row.updated_at,
    snoozedUntil: row.snoozed_until || null,
    potentialImpact: number(row.potential_impact),
    confidence: number(row.detection_confidence, 0.5),
    priority: priorityForRow(row, group),
    primaryAction: resolvePrimaryAction(row, metadata),
    metadata,
  };
}

async function upsertGeneratedActions(client, actions, recurrencePrefix) {
  const activeKeys = [];
  for (const action of actions) {
    activeKeys.push(action.recurrenceKey);
    const existing = await client.query(
      'SELECT id, user_status, completion_result FROM smart_action_items WHERE recurrence_key = $1 ORDER BY id DESC LIMIT 1',
      [action.recurrenceKey],
    );
    const existingRow = existing.rows[0];
    if (existingRow) {
      const shouldReactivate = existingRow.user_status === 'resolved'
        && existingRow.completion_result === 'auto_resolved';
      await client.query(`
        UPDATE smart_action_items
        SET action_type = $1, severity = $2, title = $3, description = $4,
          detected_at = $5, metadata = $6, potential_impact = $7,
          detection_confidence = $8,
          user_status = CASE WHEN $9 THEN 'active' ELSE user_status END,
          resolved_at = CASE WHEN $9 THEN NULL ELSE resolved_at END,
          completion_result = CASE WHEN $9 THEN NULL ELSE completion_result END,
          updated_at = datetime('now')
        WHERE id = $10
      `, [
        action.actionType,
        action.severity,
        action.title,
        action.description,
        action.detectedAt,
        JSON.stringify(action.metadata),
        action.potentialImpact,
        action.confidence,
        shouldReactivate,
        existingRow.id,
      ]);
      continue;
    }

    await client.query(`
      INSERT INTO smart_action_items (
        action_type, severity, title, description, detected_at, user_status,
        metadata, potential_impact, detection_confidence, recurrence_key, is_recurring
      ) VALUES ($1, $2, $3, $4, $5, 'active', $6, $7, $8, $9, 1)
    `, [
      action.actionType,
      action.severity,
      action.title,
      action.description,
      action.detectedAt,
      JSON.stringify(action.metadata),
      action.potentialImpact,
      action.confidence,
      action.recurrenceKey,
    ]);
  }

  const params = [`${recurrencePrefix}%`, ...activeKeys];
  const notInClause = activeKeys.length > 0
    ? `AND recurrence_key NOT IN (${activeKeys.map((_, index) => `$${index + 2}`).join(', ')})`
    : '';
  await client.query(`
    UPDATE smart_action_items
    SET user_status = 'resolved', resolved_at = datetime('now'),
      completion_result = 'auto_resolved', updated_at = datetime('now')
    WHERE recurrence_key LIKE $1
      AND user_status IN ('active', 'accepted', 'snoozed')
      ${notInClause}
  `, params);
}

function buildSummary(items) {
  const openItems = items.filter((item) => ['active', 'accepted'].includes(item.status));
  const snoozedItems = items.filter((item) => item.status === 'snoozed');
  const completedItems = items.filter((item) => ['resolved', 'dismissed'].includes(item.status));
  const byGroup = { data: 0, cash: 0, improve: 0 };
  openItems.forEach((item) => {
    byGroup[item.group] = (byGroup[item.group] || 0) + 1;
  });
  return {
    open: openItems.length,
    snoozed: snoozedItems.length,
    completed: completedItems.length,
    estimatedMinutes: openItems.reduce((sum, item) => sum + (item.group === 'data' ? 1 : 2), 0),
    potentialImpact: openItems.reduce((sum, item) => sum + item.potentialImpact, 0),
    byGroup,
  };
}

async function getMoneyReview(options = {}) {
  let hiddenSourceKeys = new Set();
  try {
    hiddenSourceKeys = financialTruthService.getHiddenSourceKeys();
  } catch (error) {
    if (process.env.NODE_ENV !== 'test') console.warn('Money Review presentation state unavailable:', error?.message || error);
  }
  const forecastAccuracy = loadForecastAccuracy();
  const subscriptionRequest = subscriptionsService.getSubscriptionAlerts({
    locale: options.locale || 'he',
  }).then((payload) => ({ available: true, payload })).catch((error) => {
    console.warn('Money Review subscription alerts unavailable:', error?.message || error);
    return { available: false, payload: { alerts: [] } };
  });
  const [notificationPayload, subscriptionResult] = await Promise.all([
    notificationsService.getNotifications({
      type: 'all',
      severity: 'all',
      limit: '250',
      include_dismissed: 'true',
    }),
    subscriptionRequest,
  ]);
  const notificationActions = normalizeNotificationResponse(notificationPayload)
    .map(notificationToSmartAction)
    .filter(Boolean);
  const subscriptionActions = (subscriptionResult.payload?.alerts || [])
    .map(subscriptionAlertToSmartAction)
    .filter(Boolean);

  const client = await database.getClient();
  try {
    await client.query('BEGIN IMMEDIATE');
    try {
      await client.query(`
        UPDATE smart_action_items
        SET user_status = 'active', snoozed_until = NULL, updated_at = datetime('now')
        WHERE user_status = 'snoozed'
          AND snoozed_until IS NOT NULL
          AND snoozed_until <= datetime('now')
      `);
      await upsertGeneratedActions(client, notificationActions, REVIEW_NOTIFICATION_PREFIX);
      if (subscriptionResult.available) {
        await upsertGeneratedActions(client, subscriptionActions, REVIEW_SUBSCRIPTION_PREFIX);
      }
      const result = await client.query(`
        SELECT * FROM smart_action_items
        WHERE user_status IN ('active', 'accepted', 'snoozed')
           OR (user_status IN ('resolved', 'dismissed') AND updated_at >= datetime('now', '-30 days'))
        ORDER BY updated_at DESC, id DESC
        LIMIT 250
      `);
      const items = result.rows
        .filter((row) => !hiddenSourceKeys.has(row.recurrence_key))
        .map(normalizeReviewRow).sort((left, right) => {
        const statusRank = { active: 0, accepted: 0, snoozed: 1, resolved: 2, dismissed: 3 };
        const rankDiff = (statusRank[left.status] ?? 4) - (statusRank[right.status] ?? 4);
        if (rankDiff !== 0) return rankDiff;
        if (left.priority !== right.priority) return right.priority - left.priority;
        return right.id - left.id;
      });
      const response = {
        success: true,
        generatedAt: new Date().toISOString(),
        truthRevision: subscriptionResult.payload?.truthRevision || 0,
        refreshState: 'ready',
        forecastAccuracy,
        summary: buildSummary(items),
        items,
      };
      await client.query('COMMIT');
      return response;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Preserve the original refresh error.
      }
      throw error;
    }
  } finally {
    client.release?.();
  }
}

async function syncOptimizerLifecycle(client, smartActionId, status, snoozePreset) {
  const lifecycle = {
    active: 'started',
    accepted: 'started',
    snoozed: 'snoozed',
    resolved: 'done',
    dismissed: 'dismissed',
  }[status];
  if (!lifecycle) return;
  await client.query(`
    UPDATE optimizer_v2_candidates
    SET lifecycle_state = $1,
      snooze_preset = CASE WHEN $1 = 'snoozed' THEN $2 ELSE snooze_preset END,
      outcome_band = CASE WHEN $1 = 'done' THEN COALESCE(outcome_band, 'unknown') ELSE outcome_band END,
      dismiss_reason = CASE WHEN $1 = 'dismissed' THEN COALESCE(dismiss_reason, 'not_relevant') ELSE dismiss_reason END,
      updated_at = datetime('now')
    WHERE smart_action_item_id = $3
  `, [lifecycle, snoozePreset || null, smartActionId]);
}

async function syncSubscriptionLifecycle(client, row, status) {
  const metadata = parseJson(row.metadata, {});
  const alertId = Number.parseInt(metadata.subscriptionAlertId, 10);
  if (metadata.source !== 'subscription' || !Number.isSafeInteger(alertId) || alertId <= 0) return;

  if (status === 'dismissed') {
    await client.query(`
      UPDATE subscription_alerts
      SET is_dismissed = 1, dismissed_at = datetime('now')
      WHERE id = $1
    `, [alertId]);
  } else if (status === 'resolved') {
    await client.query(`
      UPDATE subscription_alerts
      SET is_actioned = 1, actioned_at = datetime('now'), action_taken = 'money_review'
      WHERE id = $1
    `, [alertId]);
  } else if (status === 'active') {
    await client.query(`
      UPDATE subscription_alerts
      SET is_dismissed = 0, dismissed_at = NULL,
        is_actioned = 0, actioned_at = NULL, action_taken = NULL
      WHERE id = $1
    `, [alertId]);
  }
}

async function updateMoneyReviewItem(itemId, payload = {}) {
  const id = Number.parseInt(itemId, 10);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw serviceError(400, 'Invalid review item ID', 'INVALID_REVIEW_ITEM_ID');
  }
  const status = String(payload.status || '');
  if (!REVIEW_STATUSES.has(status)) {
    throw serviceError(400, 'Invalid review item status', 'INVALID_REVIEW_STATUS');
  }
  const snoozePreset = status === 'snoozed' ? String(payload.snoozePreset || '') : null;
  const snoozeDays = snoozePreset ? SNOOZE_DAYS.get(snoozePreset) : null;
  if (status === 'snoozed' && !snoozeDays) {
    throw serviceError(400, 'Choose a valid snooze period', 'INVALID_SNOOZE_PRESET');
  }

  const client = await database.getClient();
  try {
    await client.query('BEGIN IMMEDIATE');
    try {
      const existing = await client.query('SELECT * FROM smart_action_items WHERE id = $1 LIMIT 1', [id]);
      if (!existing.rows[0]) {
        throw serviceError(404, 'Review item not found', 'REVIEW_ITEM_NOT_FOUND');
      }
      await client.query(`
        UPDATE smart_action_items
        SET user_status = $1,
          accepted_at = CASE WHEN $1 = 'accepted' THEN COALESCE(accepted_at, datetime('now')) ELSE accepted_at END,
          snoozed_until = CASE WHEN $1 = 'snoozed' THEN datetime('now', $2) ELSE NULL END,
          resolved_at = CASE WHEN $1 = 'resolved' THEN datetime('now') ELSE NULL END,
          dismissed_at = CASE WHEN $1 = 'dismissed' THEN datetime('now') ELSE NULL END,
          completion_result = CASE WHEN $1 = 'resolved' THEN 'user_resolved' ELSE completion_result END,
          updated_at = datetime('now')
        WHERE id = $3
      `, [status, snoozeDays ? `+${snoozeDays} days` : '+0 days', id]);
      await syncOptimizerLifecycle(client, id, status, snoozePreset);
      await syncSubscriptionLifecycle(client, existing.rows[0], status);
      const updated = await client.query('SELECT * FROM smart_action_items WHERE id = $1 LIMIT 1', [id]);
      const response = { success: true, item: normalizeReviewRow(updated.rows[0]) };
      await client.query('COMMIT');
      try {
        financialTruthService.setPresentationDismissal(existing.rows[0].recurrence_key, {
          hidden: status === 'dismissed',
          sourceType: parseJson(existing.rows[0].metadata, {}).source || 'money-review',
        });
      } catch (error) {
        if (process.env.NODE_ENV !== 'test') console.warn('Money Review hide sync unavailable:', error?.message || error);
      }
      return response;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Preserve the original lifecycle error.
      }
      throw error;
    }
  } finally {
    client.release?.();
  }
}

module.exports = {
  getMoneyReview,
  updateMoneyReviewItem,
  utils: {
    buildSummary,
    loadForecastAccuracy,
    normalizeNotificationResponse,
    normalizeReviewRow,
    notificationToSmartAction,
    priorityForRow,
    subscriptionAlertToSmartAction,
  },
};
module.exports.default = module.exports;
