/**
 * Investment Notification Service
 * Handles automatic notifications when users categorize transactions as investments
 * Shows notifications and badge indicators for pending account suggestions
 */

export interface InvestmentCategoryEvent {
  transactionId: string;
  transactionVendor: string;
  transactionDescription: string;
  categoryName: string;
  categoryType: string;
}

// Store pending suggestion count for badge indicator
let pendingSuggestionCount = 0;
const pendingSuggestionListeners: Array<(count: number) => void> = [];

/**
 * Subscribe to pending suggestion count changes
 */
export function subscribeToPendingSuggestions(callback: (count: number) => void): () => void {
  pendingSuggestionListeners.push(callback);

  // Immediately call with current count
  callback(pendingSuggestionCount);

  // Return unsubscribe function
  return () => {
    const index = pendingSuggestionListeners.indexOf(callback);
    if (index > -1) {
      pendingSuggestionListeners.splice(index, 1);
    }
  };
}

/**
 * Update pending suggestion count and notify listeners
 */
function updatePendingSuggestionCount(count: number) {
  pendingSuggestionCount = count;
  pendingSuggestionListeners.forEach(listener => listener(count));
}

/**
 * Fetch current pending suggestions count from API
 */
export async function refreshPendingSuggestionsCount(): Promise<number> {
  try {
    const response = await fetch('/api/investments/suggestions/pending');
    const data = await response.json();

    if (data.success) {
      updatePendingSuggestionCount(data.count || 0);
      return data.count || 0;
    }

    return 0;
  } catch (error) {
    console.error('Failed to fetch pending suggestions count:', error);
    return 0;
  }
}

/**
 * Show notification for investment detection
 * Dispatches a custom event that can be caught by NotificationContext
 */
export function showInvestmentDetectedNotification(
  accountName: string,
  onCreateClick: () => void
): void {
  // Dispatch custom event for notification
  const event = new CustomEvent('showInvestmentNotification', {
    detail: {
      message: `השקעה זוהתה! נמצאה עסקה שקשורה ל-${accountName}`,
      severity: 'info',
      accountName,
      onCreateClick
    }
  });
  window.dispatchEvent(event);
}

/**
 * Handle investment category assignment event
 * This is called when a user assigns an investment category to a transaction
 */
export async function handleInvestmentCategoryAssigned(
  event: InvestmentCategoryEvent,
  onCreateAccountClick?: () => void
): Promise<void> {
  try {
    // Analyze this specific transaction
    const response = await fetch('/api/investments/analyze-transactions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        thresholdDays: 90
      })
    });

    const data = await response.json();

    if (data.success && data.suggestions && data.suggestions.length > 0) {
      // Find suggestion matching this transaction
      const matchingSuggestion = data.suggestions.find((s: any) =>
        s.transactions.some((t: any) =>
          t.transactionIdentifier === event.transactionId &&
          t.transactionVendor === event.transactionVendor
        )
      );

      if (matchingSuggestion) {
        // Update badge count
        await refreshPendingSuggestionsCount();

        // Show notification
        const accountName = matchingSuggestion.suggestedAccountName || event.categoryName;

        showInvestmentDetectedNotification(accountName, () => {
          if (onCreateAccountClick) {
            onCreateAccountClick();
          } else {
            // Default: navigate to accounts management
            window.location.hash = '#/accounts?tab=investment';
          }
        });
      }
    }
  } catch (error) {
    console.error('Failed to handle investment category assignment:', error);
  }
}

/**
 * Get current pending suggestions count (synchronous)
 */
export function getPendingSuggestionsCount(): number {
  return pendingSuggestionCount;
}

/**
 * Initialize the notification service
 * Should be called on app startup
 */
export async function initializeInvestmentNotifications(): Promise<void> {
  // Fetch initial count
  await refreshPendingSuggestionsCount();

  // Listen for category assignment events
  if (typeof window !== 'undefined') {
    window.addEventListener('categoryAssigned', ((event: CustomEvent) => {
      const detail = event.detail;

      // Check if it's an investment category
      if (detail.categoryType === 'investment') {
        handleInvestmentCategoryAssigned({
          transactionId: detail.transactionId,
          transactionVendor: detail.transactionVendor,
          transactionDescription: detail.transactionDescription,
          categoryName: detail.categoryName,
          categoryType: detail.categoryType
        });
      }
    }) as EventListener);
  }
}

// Auto-initialize when imported (if in browser context)
if (typeof window !== 'undefined') {
  // Delay initialization slightly to ensure DOM is ready
  setTimeout(() => {
    initializeInvestmentNotifications().catch(console.error);
  }, 1000);
}
