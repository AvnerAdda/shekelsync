type SupportedLocale = 'en' | 'he';

interface TimelineStrings {
  outflow: string;
  inflow: string;
  income: string;
  fallbackLegend: string;
  hint: string;
}

interface GeneralBreakdownStrings {
  transactions: string;
  processed: string;
  pending: string;
  total: string;
  average: string;
  subcategories: string;
  vendors: string;
  spent: string;
  invested: string;
  income: string;
  cards: string;
  recentTransactions: string;
  pendingBadge: string;
  processedDatePrefix: string;
}

interface BreakdownStrings {
  timeline: TimelineStrings;
  general: GeneralBreakdownStrings;
  categoryDetails: {
    processedBreakdown: (processed: number, pending: number) => string;
  };
  panel: {
    rootBreadcrumb: string;
    overviewTab: string;
    categoryTab: string;
    vendorTab: string;
    timelineTab: string;
  };
}

const STRINGS: Record<SupportedLocale, BreakdownStrings> = {
  en: {
    timeline: {
      outflow: 'Outflow',
      inflow: 'Inflow',
      income: 'Income',
      fallbackLegend: 'Total',
      hint: 'Click to drill down or view details',
    },
    general: {
      transactions: 'transactions',
      processed: 'processed',
      pending: 'pending',
      total: 'Total',
      average: 'Average',
      subcategories: 'Subcategories',
      vendors: 'By Vendor',
      spent: 'Spent',
      invested: 'Invested',
      income: 'Income',
      cards: 'By Card',
      recentTransactions: 'Recent Transactions',
      pendingBadge: 'Pending',
      processedDatePrefix: 'Processed',
    },
    categoryDetails: {
      processedBreakdown: (processed, pending) =>
        `${processed} processed, ${pending} pending`,
    },
    panel: {
      rootBreadcrumb: 'All Categories',
      overviewTab: 'Overview',
      categoryTab: 'Category',
      vendorTab: 'Vendor',
      timelineTab: 'Timeline',
    },
  },
  he: {
    timeline: {
      outflow: 'הוצאות',
      inflow: 'הכנסות',
      income: 'הכנסה',
      fallbackLegend: 'סה״כ',
      hint: 'לחצו להעמקה או לצפייה בפרטים',
    },
    general: {
      transactions: 'עסקאות',
      processed: 'מעובדות',
      pending: 'ממתינות',
      total: 'סך הכל',
      average: 'ממוצע',
      subcategories: 'תת-קטגוריות',
      vendors: 'לפי ספק',
      spent: 'הוצאות',
      invested: 'השקעה',
      income: 'הכנסה',
      cards: 'לפי כרטיס',
      recentTransactions: 'עסקאות אחרונות',
      pendingBadge: 'ממתינה',
      processedDatePrefix: 'עובד',
    },
    categoryDetails: {
      processedBreakdown: (processed, pending) =>
        `${processed} מעובדות, ${pending} ממתינות`,
    },
    panel: {
      rootBreadcrumb: 'כל הקטגוריות',
      overviewTab: 'סקירה',
      categoryTab: 'קטגוריות',
      vendorTab: 'ספקים',
      timelineTab: 'ציר זמן',
    },
  },
};

function normalizeLocale(locale?: string): SupportedLocale {
  if (locale && locale.toLowerCase().startsWith('he')) {
    return 'he';
  }

  if (typeof navigator !== 'undefined') {
    const navLocale = navigator.language || navigator.languages?.[0];
    if (navLocale?.toLowerCase().startsWith('he')) {
      return 'he';
    }
  }

  return 'en';
}

export function getBreakdownStrings(locale?: string): BreakdownStrings {
  const normalized = normalizeLocale(locale);
  return STRINGS[normalized] || STRINGS.en;
}
