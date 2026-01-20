const SUPPORTED_LOCALES = ['he', 'en', 'fr'];

// Quest text templates for each locale
const QUEST_TEMPLATES = {
  en: {
    quest_reduce_spending: {
      title: 'Reduce {{categoryName}} spending by {{reductionPct}}%',
      description: 'Your {{categoryName}} {{averageLabel}} is about ₪{{baseline}}. Aim for ₪{{target}} or less this {{period}}.',
    },
    quest_budget_adherence: {
      title: 'Stay on budget: {{categoryName}}',
      description: 'Challenge: Keep {{categoryName}} within your ₪{{limit}} budget until month-end ({{daysRemaining}} days left). You have ₪{{remaining}} remaining.',
    },
    quest_set_budget: {
      title: 'Set a budget for {{categoryName}}',
      description: 'Your {{categoryName}} spending averages about ₪{{avgMonthly}} per month and varies between ₪{{minAmount}}-₪{{maxAmount}} per purchase. Set a budget around ₪{{suggestedBudget}} to gain control.',
    },
    quest_reduce_fixed_cost: {
      title: 'Review & reduce: {{categoryName}}',
      description: 'Your average {{categoryName}} charge is ₪{{avgAmount}}. Review if you can find a better deal or negotiate a lower rate.',
    },
    quest_savings_target: {
      title: 'Save ₪{{savingsTarget}} this month',
      description: 'Based on your under-budget categories, you could save an extra ₪{{savingsTarget}}. Transfer this to savings before month-end.',
    },
    quest_merchant_limit: {
      title: 'Reduce {{merchantName}} visits',
      description: 'Challenge: Visit {{merchantName}} max {{targetVisits}} times this week (currently ~{{baselineVisits}}/week). Save up to ₪{{potentialSavings}}.',
    },
    quest_weekend_limit: {
      title: 'Weekend Spending Challenge',
      description: 'Challenge: Keep your weekend spending under ₪{{targetAmount}} this week. Your average is ₪{{avgWeekendSpend}}.',
    },
    averageLabels: {
      weekly: 'weekly average',
      monthly: 'monthly average',
    },
    periods: {
      week: 'week',
      month: 'month',
    },
  },
  he: {
    quest_reduce_spending: {
      title: 'צמצם הוצאות {{categoryName}} ב-{{reductionPct}}%',
      description: 'הממוצע {{averageLabel}} של {{categoryName}} הוא כ-₪{{baseline}}. נסה להגיע ל-₪{{target}} או פחות ה{{period}} הזה.',
    },
    quest_budget_adherence: {
      title: 'עמוד בתקציב: {{categoryName}}',
      description: 'אתגר: שמור על {{categoryName}} בגבולות התקציב של ₪{{limit}} עד סוף החודש (נותרו {{daysRemaining}} ימים). נותרו לך ₪{{remaining}}.',
    },
    quest_set_budget: {
      title: 'הגדר תקציב ל{{categoryName}}',
      description: 'ההוצאה הממוצעת שלך על {{categoryName}} היא כ-₪{{avgMonthly}} לחודש ונעה בין ₪{{minAmount}}-₪{{maxAmount}} לרכישה. הגדר תקציב של כ-₪{{suggestedBudget}} לשליטה טובה יותר.',
    },
    quest_reduce_fixed_cost: {
      title: 'בדוק והפחת: {{categoryName}}',
      description: 'החיוב הממוצע שלך על {{categoryName}} הוא ₪{{avgAmount}}. בדוק אם אפשר למצוא עסקה טובה יותר או לנהל משא ומתן על מחיר נמוך יותר.',
    },
    quest_savings_target: {
      title: 'חסוך ₪{{savingsTarget}} החודש',
      description: 'לפי הקטגוריות שבהן את/ה מתחת לתקציב, אפשר לחסוך עוד ₪{{savingsTarget}}. העבר לחיסכון לפני סוף החודש.',
    },
    quest_merchant_limit: {
      title: 'הפחת ביקורים ב{{merchantName}}',
      description: 'אתגר: בקר ב{{merchantName}} מקסימום {{targetVisits}} פעמים השבוע (כרגע ~{{baselineVisits}} בשבוע). חסוך עד ₪{{potentialSavings}}.',
    },
    quest_weekend_limit: {
      title: 'אתגר הוצאות סוף שבוע',
      description: 'אתגר: שמור על הוצאות סוף השבוע מתחת ל-₪{{targetAmount}} השבוע. הממוצע שלך הוא ₪{{avgWeekendSpend}}.',
    },
    averageLabels: {
      weekly: 'השבועי',
      monthly: 'החודשי',
    },
    periods: {
      week: 'שבוע',
      month: 'חודש',
    },
  },
  fr: {
    quest_reduce_spending: {
      title: 'Réduire les dépenses {{categoryName}} de {{reductionPct}}%',
      description: 'Votre {{averageLabel}} pour {{categoryName}} est d\'environ ₪{{baseline}}. Visez ₪{{target}} ou moins cette {{period}}.',
    },
    quest_budget_adherence: {
      title: 'Respecter le budget: {{categoryName}}',
      description: 'Défi: Gardez {{categoryName}} dans votre budget de ₪{{limit}} jusqu\'à la fin du mois ({{daysRemaining}} jours restants). Il vous reste ₪{{remaining}}.',
    },
    quest_set_budget: {
      title: 'Définir un budget pour {{categoryName}}',
      description: 'Vos dépenses {{categoryName}} sont en moyenne de ₪{{avgMonthly}} par mois et varient entre ₪{{minAmount}}-₪{{maxAmount}} par achat. Définissez un budget d\'environ ₪{{suggestedBudget}} pour mieux contrôler.',
    },
    quest_reduce_fixed_cost: {
      title: 'Réviser et réduire: {{categoryName}}',
      description: 'Votre charge moyenne pour {{categoryName}} est de ₪{{avgAmount}}. Voyez si vous pouvez trouver une meilleure offre ou négocier un tarif plus bas.',
    },
    quest_savings_target: {
      title: 'Économiser ₪{{savingsTarget}} ce mois-ci',
      description: 'Selon vos catégories sous-budget, vous pourriez économiser ₪{{savingsTarget}} de plus. Transférez vers l\'épargne avant la fin du mois.',
    },
    quest_merchant_limit: {
      title: 'Réduire les visites chez {{merchantName}}',
      description: 'Défi: Visitez {{merchantName}} maximum {{targetVisits}} fois cette semaine (actuellement ~{{baselineVisits}}/semaine). Économisez jusqu\'à ₪{{potentialSavings}}.',
    },
    quest_weekend_limit: {
      title: 'Défi Dépenses de Week-end',
      description: 'Défi: Gardez vos dépenses de week-end sous ₪{{targetAmount}} cette semaine. Votre moyenne est de ₪{{avgWeekendSpend}}.',
    },
    averageLabels: {
      weekly: 'moyenne hebdomadaire',
      monthly: 'moyenne mensuelle',
    },
    periods: {
      week: 'semaine',
      month: 'mois',
    },
  },
};

/**
 * Get localized quest text (title and description)
 * @param {string} questType - The quest action type (e.g., 'quest_reduce_spending')
 * @param {Object} params - Parameters to interpolate into the template
 * @param {string} locale - The locale to use (he, en, fr)
 * @returns {Object} - { title, description }
 */
function getQuestText(questType, params = {}, locale = 'he') {
  const normalized = normalizeLocale(locale) || 'he';
  const templates = QUEST_TEMPLATES[normalized] || QUEST_TEMPLATES.he;
  const questTemplate = templates[questType];

  if (!questTemplate) {
    return { title: questType, description: '' };
  }

  const interpolate = (str) => {
    return str.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      return params[key] !== undefined ? params[key] : match;
    });
  };

  return {
    title: interpolate(questTemplate.title),
    description: interpolate(questTemplate.description),
  };
}

/**
 * Get localized period label (week/month)
 * @param {number} durationDays - Duration in days
 * @param {string} locale - The locale to use
 * @returns {string} - Localized period label
 */
function getLocalizedPeriodLabel(durationDays, locale = 'he') {
  const normalized = normalizeLocale(locale) || 'he';
  const templates = QUEST_TEMPLATES[normalized] || QUEST_TEMPLATES.he;
  return durationDays >= 30 ? templates.periods.month : templates.periods.week;
}

/**
 * Get localized average label (weekly/monthly average)
 * @param {number} durationDays - Duration in days
 * @param {string} locale - The locale to use
 * @returns {string} - Localized average label
 */
function getLocalizedAverageLabel(durationDays, locale = 'he') {
  const normalized = normalizeLocale(locale) || 'he';
  const templates = QUEST_TEMPLATES[normalized] || QUEST_TEMPLATES.he;
  return durationDays >= 30 ? templates.averageLabels.monthly : templates.averageLabels.weekly;
}

function normalizeLocale(value) {
  if (!value || typeof value !== 'string') return null;
  const base = value.toLowerCase().split(',')[0].split('-')[0];
  return SUPPORTED_LOCALES.includes(base) ? base : null;
}

function resolveLocale(candidate) {
  if (candidate && typeof candidate === 'string') {
    const normalized = normalizeLocale(candidate);
    if (normalized) return normalized;
  }
  return 'he';
}

function resolveLocaleFromRequest(req) {
  const headerLocale = normalizeLocale(req?.headers?.['x-locale'])
    || normalizeLocale(req?.headers?.['accept-language']);
  const queryLocale = normalizeLocale(req?.query?.locale);
  const directLocale = normalizeLocale(req?.locale);

  return directLocale || queryLocale || headerLocale || 'he';
}

function getLocalizedCategoryName(names = {}, locale = 'he') {
  const normalized = normalizeLocale(locale) || 'he';
  const { name, name_en: nameEn, name_fr: nameFr } = names;

  if (normalized === 'fr') {
    return nameFr || nameEn || name || null;
  }
  if (normalized === 'en') {
    return nameEn || nameFr || name || null;
  }
  return name || nameFr || nameEn || null;
}

module.exports = {
  SUPPORTED_LOCALES,
  normalizeLocale,
  resolveLocale,
  resolveLocaleFromRequest,
  getLocalizedCategoryName,
  getQuestText,
  getLocalizedPeriodLabel,
  getLocalizedAverageLabel,
  QUEST_TEMPLATES,
};

module.exports.default = module.exports;
