const STORED_ALERT_FRESHNESS_DAYS = 90;

function activeSubscriptionAlertPredicate(alias = 'subscription_alert') {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) {
    throw new Error('Invalid subscription alert SQL alias');
  }

  return `(
    ${alias}.expires_at > datetime('now')
    OR (
      ${alias}.expires_at IS NULL
      AND ${alias}.created_at >= datetime('now', '-${STORED_ALERT_FRESHNESS_DAYS} days')
    )
  )`;
}

module.exports = {
  STORED_ALERT_FRESHNESS_DAYS,
  activeSubscriptionAlertPredicate,
};

