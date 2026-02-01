type SupportedLocale = 'he' | 'en' | 'fr';

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
  pieChart: string;
  sunburstChart: string;
}

interface BreakdownStrings {
  timeline: TimelineStrings;
  general: GeneralBreakdownStrings;
  overview: {
    pendingBreakdown: (processed: number, pending: number) => string;
  };
  categoryDetails: {
    processedBreakdown: (processed: number, pending: number) => string;
  };
  panel: {
    rootBreadcrumb: string;
    overviewTab: string;
    categoryTab: string;
    vendorTab: string;
    timelineTab: string;
    titles: {
      expense: string;
      income: string;
      investment: string;
    };
    chartTitles: {
      expense: string;
      income: string;
      investment: string;
      parent: (name: string) => string;
      subcategory: (name: string) => string;
    };
    summary: {
      total: {
        expense: string;
        income: string;
        investment: string;
      };
      transactions: string;
      average: string;
    };
    aria: {
      vendorTrend: (vendor: string) => string;
    };
  };
}

const STRINGS: Record<SupportedLocale, BreakdownStrings> = {
  fr: {
    timeline: {
      outflow: 'Sorties',
      inflow: 'Entrées',
      income: 'Revenus',
      fallbackLegend: 'Total',
      hint: 'Cliquez pour explorer ou voir les détails',
    },
    general: {
      transactions: 'transactions',
      processed: 'traitées',
      pending: 'en attente',
      total: 'Total',
      average: 'Moyenne',
      subcategories: 'Sous-catégories',
      vendors: 'Par fournisseur',
      spent: 'Dépensé',
      invested: 'Investi',
      income: 'Revenus',
      cards: 'Par carte',
      recentTransactions: 'Transactions récentes',
      pendingBadge: 'En attente',
      processedDatePrefix: 'Traitée',
      pieChart: 'Secteurs',
      sunburstChart: 'Hiérarchique',
    },
    overview: {
      pendingBreakdown: (processed, pending) => `${processed} + ${pending} en attente`,
    },
    categoryDetails: {
      processedBreakdown: (processed, pending) =>
        `${processed} traitées, ${pending} en attente`,
    },
    panel: {
      rootBreadcrumb: 'Toutes les catégories',
      overviewTab: 'Vue d’ensemble',
      categoryTab: 'Catégories',
      vendorTab: 'Fournisseurs',
      timelineTab: 'Chronologie',
      titles: {
        expense: 'Répartition des dépenses',
        income: 'Répartition des revenus',
        investment: 'Répartition des investissements',
      },
      chartTitles: {
        expense: 'Dépenses par catégorie',
        income: 'Revenus par catégorie',
        investment: 'Investissements par catégorie',
        parent: (name: string) => `Répartition de ${name}`,
        subcategory: (name: string) => `Détails ${name}`,
      },
      summary: {
        total: {
          expense: 'Total dépensé',
          income: 'Total revenus',
          investment: 'Total mouvements',
        },
        transactions: 'Transactions',
        average: 'Moyenne',
      },
      aria: {
        vendorTrend: (vendor: string) => `Tendance pour ${vendor}`,
      },
    },
  },
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
      pieChart: 'Pie',
      sunburstChart: 'Sunburst',
    },
    overview: {
      pendingBreakdown: (processed, pending) => `${processed} + ${pending} pending`,
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
      titles: {
        expense: 'Expenses Breakdown',
        income: 'Income Breakdown',
        investment: 'Investment Breakdown',
      },
      chartTitles: {
        expense: 'Expenses by Category',
        income: 'Income by Category',
        investment: 'Investments by Category',
        parent: (name: string) => `${name} Breakdown`,
        subcategory: (name: string) => `${name} Details`,
      },
      summary: {
        total: {
          expense: 'Total Spent',
          income: 'Total Income',
          investment: 'Total Movement',
        },
        transactions: 'Transactions',
        average: 'Average',
      },
      aria: {
        vendorTrend: (vendor: string) => `Trend for ${vendor}`,
      },
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
      pieChart: 'עוגה',
      sunburstChart: 'היררכי',
    },
    overview: {
      pendingBreakdown: (processed, pending) => `${processed} + ${pending} ממתינות`,
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
      titles: {
        expense: 'פילוח הוצאות',
        income: 'פילוח הכנסות',
        investment: 'פילוח השקעות',
      },
      chartTitles: {
        expense: 'הוצאות לפי קטגוריה',
        income: 'הכנסות לפי קטגוריה',
        investment: 'השקעות לפי קטגוריה',
        parent: (name: string) => `פילוח ${name}`,
        subcategory: (name: string) => `פרטי ${name}`,
      },
      summary: {
        total: {
          expense: 'סה״כ הוצאות',
          income: 'סה״כ הכנסות',
          investment: 'סה״כ תנועות',
        },
        transactions: 'עסקאות',
        average: 'ממוצע',
      },
      aria: {
        vendorTrend: (vendor: string) => `מגמה עבור ${vendor}`,
      },
    },
  },
};

function normalizeLocale(locale?: string): SupportedLocale {
  const normalize = (value?: string) => value?.toLowerCase();
  const normalizedLocale = normalize(locale);

  if (normalizedLocale?.startsWith('fr')) {
    return 'fr';
  }

  if (normalizedLocale?.startsWith('he')) {
    return 'he';
  }

  if (normalizedLocale?.startsWith('en')) {
    return 'en';
  }

  if (typeof navigator !== 'undefined') {
    const navLocale = normalize(navigator.language || navigator.languages?.[0]);
    if (navLocale?.startsWith('fr')) {
      return 'fr';
    }
    if (navLocale?.startsWith('he')) {
      return 'he';
    }
    if (navLocale?.startsWith('en')) {
      return 'en';
    }
  }

  return 'he';
}

export function getBreakdownStrings(locale?: string): BreakdownStrings {
  const normalized = normalizeLocale(locale);
  return STRINGS[normalized] || STRINGS.he;
}
