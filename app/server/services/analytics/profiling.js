const crypto = require('crypto');

const database = require('../database.js');
const { BANK_CATEGORY_NAME } = require('../../../lib/category-constants.js');
const openAiClient = require('../chat/openai-client.js');

const ASSESSMENT_TYPE = 'profiling';
const BENCHMARK_VERSION = 'israel-official-2026-01-v1';
const OPENAI_MODEL = 'gpt-4.1-mini';
const OBSERVED_WINDOW_MONTHS = 3;

const BENCHMARK_SOURCES = [
  {
    id: 'btl_average_wage_2026',
    title: 'National Insurance average wage, effective January 1, 2026',
    url: 'https://www.btl.gov.il/MEDINIYUT/GENERALDATA/Pages/%D7%A9%D7%9B%D7%A8%20%D7%9E%D7%9E%D7%95%D7%A6%D7%A2.aspx',
    effectiveDate: '2026-01-01',
  },
  {
    id: 'cbs_household_size_2022',
    title: 'CBS Household Expenditure Survey 2022: income and expenditure by household size',
    url: 'https://www.cbs.gov.il/he/publications/DocLib/2025/1952/e_print.pdf',
    effectiveDate: '2022-12-31',
  },
  {
    id: 'cbs_locality_2020',
    title: 'CBS Household Expenditure Survey 2020: gross household income by locality',
    url: 'https://www.cbs.gov.il/he/publications/DocLib/2023/1902/e_print.pdf',
    effectiveDate: '2020-12-31',
  },
  {
    id: 'cbs_occupation_age_2021',
    title: 'CBS Income of Persons 2021: gross employee income by occupation and age group',
    url: 'https://www.cbs.gov.il/he/publications/doclib/2024/persons_income21_1920/e_print.pdf',
    effectiveDate: '2021-12-31',
  },
];

const BENCHMARK_PACK = {
  version: BENCHMARK_VERSION,
  nationalAverageSalary: 13566,
  householdBySize: {
    1: { grossIncome: 10825, netIncome: 9223, moneyExpenditure: 8166, consumptionExpenditure: 10271 },
    2: { grossIncome: 20051, netIncome: 17223, moneyExpenditure: 13122, consumptionExpenditure: 16177 },
    3: { grossIncome: 23485, netIncome: 19375, moneyExpenditure: 15100, consumptionExpenditure: 18247 },
    4: { grossIncome: 29487, netIncome: 23774, moneyExpenditure: 18606, consumptionExpenditure: 21908 },
    5: { grossIncome: 32798, netIncome: 25983, moneyExpenditure: 20102, consumptionExpenditure: 24093 },
    6: { grossIncome: 22874, netIncome: 19500, moneyExpenditure: 16954, consumptionExpenditure: 20446 },
  },
  locationByKey: {
    jerusalem: { label: 'Jerusalem', grossHouseholdIncome: 15761 },
    tel_aviv_yafo: { label: 'Tel Aviv-Yafo', grossHouseholdIncome: 24819 },
    haifa: { label: 'Haifa', grossHouseholdIncome: 16782 },
    rishon_lezion: { label: 'Rishon LeZiyyon', grossHouseholdIncome: 23123 },
    ashdod: { label: 'Ashdod', grossHouseholdIncome: 16117 },
    petah_tikva: { label: 'Petah Tiqwa', grossHouseholdIncome: 22509 },
    netanya: { label: 'Natanya', grossHouseholdIncome: 20582 },
    beer_sheva: { label: 'Beer Sheva', grossHouseholdIncome: 14663 },
  },
  locationFallbacks: {
    urban_total: { label: 'Urban localities average', grossHouseholdIncome: 18922 },
    national_total: { label: 'National household average', grossHouseholdIncome: 19287 },
  },
  occupationByAgeGroup: {
    managers: {
      label: 'Managers',
      ageGroups: { '15_24': 9217, '25_34': 12318, '35_44': 20989, '45_54': 26568, '55_plus': 26288 },
    },
    professionals: {
      label: 'Professionals',
      ageGroups: { '15_24': 5955, '25_34': 11684, '35_44': 16669, '45_54': 19865, '55_plus': 17713 },
    },
    associate_professionals: {
      label: 'Practical engineers, technicians, agents, and associate professionals',
      ageGroups: { '15_24': 4939, '25_34': 8935, '35_44': 12745, '45_54': 12713, '55_plus': 12287 },
    },
    clerical_support: {
      label: 'Clerical support workers',
      ageGroups: { '15_24': 3946, '25_34': 6338, '35_44': 8051, '45_54': 9552, '55_plus': 8891 },
    },
    service_sales: {
      label: 'Service and sales workers',
      ageGroups: { '15_24': 3805, '25_34': 6069, '35_44': 7172, '45_54': 6793, '55_plus': 5872 },
    },
    skilled_workers: {
      label: 'Skilled workers',
      ageGroups: { '15_24': 5830, '25_34': 8006, '35_44': 10690, '45_54': 11298, '55_plus': 9464 },
    },
    elementary_occupations: {
      label: 'Elementary occupations',
      ageGroups: { '15_24': 3503, '25_34': 5558, '35_44': 6409, '45_54': 5758, '55_plus': 4992 },
    },
  },
};

const LOCATION_KEY_MAP = {
  'tel aviv': 'tel_aviv_yafo',
  'tel aviv-yafo': 'tel_aviv_yafo',
  'tel aviv yafo': 'tel_aviv_yafo',
  'beer sheva': 'beer_sheva',
  "be'er sheva": 'beer_sheva',
  'beersheva': 'beer_sheva',
  'jerusalem': 'jerusalem',
  'haifa': 'haifa',
  'rishon lezion': 'rishon_lezion',
  'rishon le zion': 'rishon_lezion',
  'rishon le-zion': 'rishon_lezion',
  'rishon lezion, israel': 'rishon_lezion',
  'rishon leziyyon': 'rishon_lezion',
  'petah tikva': 'petah_tikva',
  'petah tiqwa': 'petah_tikva',
  'ashdod': 'ashdod',
  'netanya': 'netanya',
  'natanya': 'netanya',
};

const OCCUPATION_GROUP_KEYWORDS = [
  {
    key: 'managers',
    keywords: [
      'manager', 'director', 'head of', 'team lead', 'vp', 'chief', 'cto', 'cfo', 'ceo', 'founder',
      'מנהל', 'מנהלת', 'סמנכ', 'מנכ', 'ראש צוות',
    ],
  },
  {
    key: 'professionals',
    keywords: [
      'engineer', 'developer', 'programmer', 'software', 'architect', 'doctor', 'physician', 'lawyer',
      'attorney', 'accountant', 'analyst', 'scientist', 'researcher', 'teacher', 'lecturer',
      'מהנדס', 'מהנדסת', 'מפתח', 'מפתחת', 'מתכנת', 'מתכנתת', 'רופא', 'רופאה', 'עו"ד', 'עורכת דין',
      'רואה חשבון', 'אנליסט', 'מורה', 'מרצה',
    ],
  },
  {
    key: 'associate_professionals',
    keywords: [
      'technician', 'practical engineer', 'qa', 'quality assurance', 'lab', 'operations specialist',
      'agent', 'technologist', 'הנדסאי', 'טכנאי', 'טכנאית', 'בודק', 'בודקת', 'מפעיל', 'מפעילה',
    ],
  },
  {
    key: 'clerical_support',
    keywords: [
      'administrator', 'admin', 'office', 'clerk', 'secretary', 'assistant', 'bookkeeper', 'reception',
      'פקיד', 'פקידה', 'מזכיר', 'מזכירה', 'אדמינ', 'בק אופיס',
    ],
  },
  {
    key: 'service_sales',
    keywords: [
      'sales', 'cashier', 'retail', 'service representative', 'customer service', 'waiter', 'barista',
      'hotel', 'restaurant', 'store', 'מכירות', 'קופאי', 'קופאית', 'שירות לקוחות', 'מלצר', 'מלצרית',
      'בריסטה', 'מסעדה', 'חנות',
    ],
  },
  {
    key: 'skilled_workers',
    keywords: [
      'electrician', 'mechanic', 'plumber', 'construction', 'builder', 'driver', 'welder', 'machinist',
      'installer', 'fabrication', 'חשמלאי', 'מכונאי', 'שרברב', 'נהג', 'נהגת', 'רתך', 'בניין', 'טכנאי שטח',
    ],
  },
  {
    key: 'elementary_occupations',
    keywords: [
      'cleaner', 'security guard', 'warehouse', 'laborer', 'delivery', 'caregiver',
      'מנקה', 'מאבטח', 'מאבטחת', 'מחסן', 'שליח', 'שליחה', 'מטפל', 'מטפלת', 'עובד כללי',
    ],
  },
];

const INDUSTRY_FALLBACK_MAP = {
  tech: 'professionals',
  finance: 'professionals',
  healthcare: 'professionals',
  education: 'professionals',
  retail: 'service_sales',
  manufacturing: 'skilled_workers',
  government: 'clerical_support',
};

let databaseAdapter = database;
let createCompletionFn = openAiClient.createCompletion;

function serviceError(status, message, extras = {}) {
  const error = new Error(message);
  error.status = status;
  Object.assign(error, extras);
  return error;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function roundNumber(value, digits = 2) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function roundCurrency(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value);
}

function toNullableNumber(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isBlank(value) {
  return value === undefined || value === null || `${value}`.trim() === '';
}

function normalizeText(value) {
  return `${value ?? ''}`
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function calculateAgeFromBirthDate(birthDate, now = new Date()) {
  if (isBlank(birthDate)) return null;
  const parsed = new Date(`${birthDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  let age = now.getUTCFullYear() - parsed.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - parsed.getUTCMonth();
  const dayDiff = now.getUTCDate() - parsed.getUTCDate();
  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
    age -= 1;
  }
  return age >= 0 ? age : null;
}

function resolveAge(profile, now = new Date()) {
  const directAge = toNullableNumber(profile?.age);
  if (Number.isFinite(directAge) && directAge >= 0) {
    return Math.floor(directAge);
  }
  return calculateAgeFromBirthDate(profile?.birth_date, now);
}

function sanitizeHouseholdSize(value) {
  const parsed = toNullableNumber(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed >= 6 ? 6 : Math.floor(parsed);
}

function resolveAgeGroup(age) {
  if (!Number.isFinite(age)) return '25_34';
  if (age <= 24) return '15_24';
  if (age <= 34) return '25_34';
  if (age <= 44) return '35_44';
  if (age <= 54) return '45_54';
  return '55_plus';
}

function collectMissingFields(profile, spouse, now = new Date()) {
  const missing = [];
  if (!profile) {
    return [
      'age_or_birth_date',
      'location',
      'monthly_income',
      'marital_status',
      'household_size',
      'children_count',
      'occupation_or_industry',
    ];
  }

  if (!Number.isFinite(resolveAge(profile, now))) {
    missing.push('age_or_birth_date');
  }
  if (isBlank(profile.location)) {
    missing.push('location');
  }
  if (profile.monthly_income === null || profile.monthly_income === undefined || profile.monthly_income === '') {
    missing.push('monthly_income');
  }
  if (isBlank(profile.marital_status)) {
    missing.push('marital_status');
  }
  if (profile.household_size === null || profile.household_size === undefined || profile.household_size === '') {
    missing.push('household_size');
  }
  if (profile.children_count === null || profile.children_count === undefined || profile.children_count === '') {
    missing.push('children_count');
  }
  if (isBlank(profile.occupation) && isBlank(profile.industry)) {
    missing.push('occupation_or_industry');
  }
  if (
    String(profile.marital_status || '').toLowerCase() === 'married'
    && (spouse?.monthly_income === null || spouse?.monthly_income === undefined || spouse?.monthly_income === '')
  ) {
    missing.push('spouse_monthly_income');
  }

  return missing;
}

function buildProfileHash(profile, spouse, now = new Date()) {
  const payload = {
    age: resolveAge(profile, now),
    birthDate: profile?.birth_date || null,
    childrenCount: toNullableNumber(profile?.children_count),
    householdSize: sanitizeHouseholdSize(profile?.household_size),
    industry: profile?.industry || null,
    location: profile?.location || null,
    maritalStatus: profile?.marital_status || null,
    monthlyIncome: toNullableNumber(profile?.monthly_income),
    occupation: profile?.occupation || null,
    spouseMonthlyIncome: toNullableNumber(spouse?.monthly_income),
  };

  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function resolveHouseholdIncome(profile, spouse) {
  const primaryIncome = toNullableNumber(profile?.monthly_income) ?? 0;
  const spouseIncome = String(profile?.marital_status || '').toLowerCase() === 'married'
    ? (toNullableNumber(spouse?.monthly_income) ?? 0)
    : 0;
  return {
    primaryIncome,
    spouseIncome,
    declaredHouseholdIncome: primaryIncome + spouseIncome,
  };
}

function resolveLocationBenchmark(rawLocation) {
  const normalized = normalizeText(rawLocation);
  const mappedKey = LOCATION_KEY_MAP[normalized];

  if (mappedKey && BENCHMARK_PACK.locationByKey[mappedKey]) {
    const benchmark = BENCHMARK_PACK.locationByKey[mappedKey];
    return {
      status: 'matched',
      key: mappedKey,
      label: benchmark.label,
      benchmarkGrossIncome: benchmark.grossHouseholdIncome,
      sourceId: 'cbs_locality_2020',
      note: `Matched to ${benchmark.label}.`,
    };
  }

  if (normalized === 'herzliya') {
    const fallback = BENCHMARK_PACK.locationFallbacks.urban_total;
    return {
      status: 'fallback',
      key: 'urban_total',
      label: fallback.label,
      benchmarkGrossIncome: fallback.grossHouseholdIncome,
      sourceId: 'cbs_locality_2020',
      note: 'No direct city benchmark in the packaged snapshot; used urban localities average.',
    };
  }

  const fallback = BENCHMARK_PACK.locationFallbacks.national_total;
  return {
    status: 'fallback',
    key: 'national_total',
    label: fallback.label,
    benchmarkGrossIncome: fallback.grossHouseholdIncome,
    sourceId: 'cbs_locality_2020',
    note: 'No direct locality benchmark in the packaged snapshot; used national household average.',
  };
}

function matchOccupationGroup(text) {
  const normalized = normalizeText(text);
  if (!normalized) return null;

  for (const candidate of OCCUPATION_GROUP_KEYWORDS) {
    if (candidate.keywords.some((keyword) => normalized.includes(normalizeText(keyword)))) {
      return candidate.key;
    }
  }

  return null;
}

function resolveOccupationBenchmark(profile, age) {
  const ageGroup = resolveAgeGroup(age);
  const occupationGroup = matchOccupationGroup(profile?.occupation);

  if (occupationGroup) {
    return {
      status: 'matched',
      groupKey: occupationGroup,
      label: BENCHMARK_PACK.occupationByAgeGroup[occupationGroup].label,
      ageGroup,
      benchmarkGrossIncome: BENCHMARK_PACK.occupationByAgeGroup[occupationGroup].ageGroups[ageGroup],
      mappingSource: 'occupation',
      sourceId: 'cbs_occupation_age_2021',
      note: 'Mapped from occupation text.',
    };
  }

  const industryKey = normalizeText(profile?.industry);
  const fallbackGroup = INDUSTRY_FALLBACK_MAP[industryKey];
  if (fallbackGroup) {
    return {
      status: 'fallback',
      groupKey: fallbackGroup,
      label: BENCHMARK_PACK.occupationByAgeGroup[fallbackGroup].label,
      ageGroup,
      benchmarkGrossIncome: BENCHMARK_PACK.occupationByAgeGroup[fallbackGroup].ageGroups[ageGroup],
      mappingSource: 'industry',
      sourceId: 'cbs_occupation_age_2021',
      note: 'Occupation text did not match; used industry fallback.',
    };
  }

  return {
    status: 'skipped',
    groupKey: null,
    label: null,
    ageGroup,
    benchmarkGrossIncome: null,
    mappingSource: null,
    sourceId: 'cbs_occupation_age_2021',
    note: 'Could not map occupation or industry to an official occupation group.',
  };
}

function scoreFromIncomeRatio(ratio) {
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return 0;
  }
  return Math.round(clamp(50 + ((ratio - 1) * 60), 0, 100));
}

function scoreFromExpenseRatio(ratio) {
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return 50;
  }
  return Math.round(clamp(50 + ((1 - ratio) * 60), 0, 100));
}

function resolveScoreBand(score) {
  if (score <= 29) return 'well_below_average';
  if (score <= 44) return 'below_average';
  if (score <= 59) return 'near_average';
  if (score <= 74) return 'above_average';
  return 'well_above_average';
}

function buildComparator({
  key,
  score,
  weight,
  status,
  actualValue,
  benchmarkValue,
  note,
  label,
  sourceId,
  mappingSource = null,
  ageGroup = null,
  weighted = true,
}) {
  const ratio = Number.isFinite(actualValue) && Number.isFinite(benchmarkValue) && benchmarkValue > 0
    ? roundNumber(actualValue / benchmarkValue, 3)
    : null;

  return {
    key,
    label,
    score,
    weight,
    weighted,
    status,
    actualValue: Number.isFinite(actualValue) ? roundCurrency(actualValue) : null,
    benchmarkValue: Number.isFinite(benchmarkValue) ? roundCurrency(benchmarkValue) : null,
    delta: Number.isFinite(actualValue) && Number.isFinite(benchmarkValue)
      ? roundCurrency(actualValue - benchmarkValue)
      : null,
    ratio,
    note,
    sourceId,
    mappingSource,
    ageGroup,
  };
}

function calculateConfidence({ locationStatus, occupationStatus, observedMetricsAvailable }) {
  let confidence = 1.0;

  if (locationStatus === 'fallback') {
    confidence -= 0.1;
  }
  if (occupationStatus === 'fallback') {
    confidence -= 0.15;
  }
  if (occupationStatus === 'skipped') {
    confidence -= 0.25;
  }
  if (!observedMetricsAvailable) {
    confidence -= 0.1;
  }

  return roundNumber(clamp(confidence, 0.5, 1), 2);
}

function resolveNarrativeLanguage(locale) {
  const normalized = `${locale || 'en'}`.toLowerCase();
  if (normalized.startsWith('he')) return 'Hebrew';
  if (normalized.startsWith('fr')) return 'French';
  return 'English';
}

function extractMessageText(content) {
  if (typeof content === 'string') {
    return content.trim();
  }
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item.text === 'string') return item.text;
        if (item && item.type === 'text' && typeof item.text === 'string') return item.text;
        return '';
      })
      .join('\n')
      .trim();
  }
  return '';
}

function sanitizeStringArray(value, fallback = []) {
  if (!Array.isArray(value)) return fallback;
  return value
    .map((item) => `${item ?? ''}`.trim())
    .filter(Boolean)
    .slice(0, 4);
}

function parseNarrativePayload(payload) {
  let parsed;
  try {
    parsed = JSON.parse(payload);
  } catch (error) {
    throw serviceError(502, 'Profiling AI response was not valid JSON', {
      details: error?.message || 'Invalid JSON',
    });
  }

  const headline = `${parsed?.headline ?? ''}`.trim();
  const summary = `${parsed?.summary ?? ''}`.trim();
  if (!headline || !summary) {
    throw serviceError(502, 'Profiling AI response was missing required fields');
  }

  return {
    headline,
    summary,
    strengths: sanitizeStringArray(parsed?.strengths),
    risks: sanitizeStringArray(parsed?.risks),
    actions: sanitizeStringArray(parsed?.actions),
    caveats: sanitizeStringArray(parsed?.caveats),
  };
}

async function loadProfileContext(client) {
  const profileResult = await client.query('SELECT * FROM user_profile LIMIT 1');
  const profile = profileResult.rows[0] || null;
  const spouse = profile?.id
    ? ((await client.query('SELECT * FROM spouse_profile WHERE user_profile_id = $1 LIMIT 1', [profile.id])).rows[0] || null)
    : null;

  return { profile, spouse };
}

async function loadSavedAssessment(client) {
  const result = await client.query(
    'SELECT * FROM profile_assessments WHERE assessment_type = $1 LIMIT 1',
    [ASSESSMENT_TYPE],
  );
  const row = result.rows[0] || null;
  if (!row) {
    return { row: null, assessment: null };
  }

  try {
    return {
      row,
      assessment: JSON.parse(row.assessment_json),
    };
  } catch {
    return {
      row,
      assessment: null,
    };
  }
}

async function loadObservedMetrics(client, endDate = new Date()) {
  const startDate = new Date(endDate);
  startDate.setMonth(startDate.getMonth() - OBSERVED_WINDOW_MONTHS);

  const start = startDate.toISOString().slice(0, 10);
  const end = endDate.toISOString().slice(0, 10);

  const result = await client.query(
    `
      SELECT
        SUM(
          CASE
            WHEN ((cd.category_type = 'income' OR (cd.category_type IS NULL AND t.price > 0)) AND t.price > 0)
            THEN t.price
            ELSE 0
          END
        ) AS income,
        SUM(
          CASE
            WHEN ((cd.category_type = 'expense' OR (cd.category_type IS NULL AND t.price < 0)) AND t.price < 0)
              AND COALESCE(cd.name, '') != $3
              AND COALESCE(parent.name, '') != $3
            THEN ABS(t.price)
            ELSE 0
          END
        ) AS expenses,
        COUNT(*) AS transaction_count
      FROM transactions t
      LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
      LEFT JOIN category_definitions parent ON cd.parent_id = parent.id
      LEFT JOIN (
        SELECT DISTINCT transaction_identifier, transaction_vendor
        FROM transaction_pairing_exclusions
      ) tpe
        ON t.identifier = tpe.transaction_identifier
        AND t.vendor = tpe.transaction_vendor
      WHERE t.date >= $1
        AND t.date <= $2
        AND tpe.transaction_identifier IS NULL
    `,
    [start, end, BANK_CATEGORY_NAME],
  );

  const row = result.rows[0] || {};
  const totalIncome = Number.parseFloat(row.income || 0);
  const totalExpenses = Number.parseFloat(row.expenses || 0);

  return {
    startDate: start,
    endDate: end,
    totalIncome: roundCurrency(totalIncome),
    totalExpenses: roundCurrency(totalExpenses),
    monthlyIncome: roundCurrency(totalIncome / OBSERVED_WINDOW_MONTHS),
    monthlyExpenses: roundCurrency(totalExpenses / OBSERVED_WINDOW_MONTHS),
    monthlySavings: roundCurrency((totalIncome - totalExpenses) / OBSERVED_WINDOW_MONTHS),
    transactionCount: Number.parseInt(String(row.transaction_count || 0), 10) || 0,
  };
}

function buildProfilingPayload({ profile, spouse, observedMetrics, locale, now = new Date() }) {
  const age = resolveAge(profile, now);
  const householdSize = sanitizeHouseholdSize(profile.household_size) ?? 1;
  const householdBenchmark = BENCHMARK_PACK.householdBySize[householdSize];
  const locationBenchmark = resolveLocationBenchmark(profile.location);
  const occupationBenchmark = resolveOccupationBenchmark(profile, age);
  const incomeMetrics = resolveHouseholdIncome(profile, spouse);

  const incomeVsHouseholdSizeScore = scoreFromIncomeRatio(
    incomeMetrics.declaredHouseholdIncome / householdBenchmark.grossIncome,
  );
  const incomeVsLocationScore = scoreFromIncomeRatio(
    incomeMetrics.declaredHouseholdIncome / locationBenchmark.benchmarkGrossIncome,
  );
  const incomeVsOccupationScore = occupationBenchmark.status === 'skipped'
    ? 50
    : scoreFromIncomeRatio(incomeMetrics.primaryIncome / occupationBenchmark.benchmarkGrossIncome);
  const observedMetricsAvailable = observedMetrics.transactionCount > 0
    || observedMetrics.totalIncome > 0
    || observedMetrics.totalExpenses > 0;
  const expensePressureScore = observedMetricsAvailable
    ? scoreFromExpenseRatio(observedMetrics.monthlyExpenses / householdBenchmark.moneyExpenditure)
    : 50;

  const weightedScore = Math.round(
    (incomeVsHouseholdSizeScore * 0.4)
    + (incomeVsOccupationScore * 0.2)
    + (incomeVsLocationScore * 0.2)
    + (expensePressureScore * 0.2),
  );

  const comparators = [
    buildComparator({
      key: 'incomeVsHouseholdSize',
      label: 'Household income vs household-size benchmark',
      score: incomeVsHouseholdSizeScore,
      weight: 0.4,
      status: 'matched',
      actualValue: incomeMetrics.declaredHouseholdIncome,
      benchmarkValue: householdBenchmark.grossIncome,
      note: `Compared against the CBS 2022 gross household income benchmark for ${householdSize >= 6 ? '6+' : householdSize}-person households.`,
      sourceId: 'cbs_household_size_2022',
    }),
    buildComparator({
      key: 'incomeVsOccupationOrIndustry',
      label: 'Income vs occupation-age benchmark',
      score: incomeVsOccupationScore,
      weight: 0.2,
      status: occupationBenchmark.status,
      actualValue: incomeMetrics.primaryIncome,
      benchmarkValue: occupationBenchmark.benchmarkGrossIncome,
      note: occupationBenchmark.note,
      sourceId: occupationBenchmark.sourceId,
      mappingSource: occupationBenchmark.mappingSource,
      ageGroup: occupationBenchmark.ageGroup,
    }),
    buildComparator({
      key: 'incomeVsLocation',
      label: 'Household income vs locality benchmark',
      score: incomeVsLocationScore,
      weight: 0.2,
      status: locationBenchmark.status,
      actualValue: incomeMetrics.declaredHouseholdIncome,
      benchmarkValue: locationBenchmark.benchmarkGrossIncome,
      note: locationBenchmark.note,
      sourceId: locationBenchmark.sourceId,
    }),
    buildComparator({
      key: 'expensePressureVsHouseholdSize',
      label: 'Observed expense pressure vs household-size benchmark',
      score: expensePressureScore,
      weight: 0.2,
      status: observedMetricsAvailable ? 'matched' : 'fallback',
      actualValue: observedMetrics.monthlyExpenses,
      benchmarkValue: householdBenchmark.moneyExpenditure,
      note: observedMetricsAvailable
        ? `Compared against the CBS 2022 money expenditure benchmark for ${householdSize >= 6 ? '6+' : householdSize}-person households using the last ${OBSERVED_WINDOW_MONTHS} months of tracked transactions.`
        : `No recent transaction baseline was available; used a neutral score.`,
      sourceId: 'cbs_household_size_2022',
    }),
    buildComparator({
      key: 'nationalWageAnchor',
      label: 'Primary income vs national wage anchor',
      score: scoreFromIncomeRatio(incomeMetrics.primaryIncome / BENCHMARK_PACK.nationalAverageSalary),
      weight: 0,
      weighted: false,
      status: 'matched',
      actualValue: incomeMetrics.primaryIncome,
      benchmarkValue: BENCHMARK_PACK.nationalAverageSalary,
      note: 'Supporting benchmark only; not included in the weighted profile grade.',
      sourceId: 'btl_average_wage_2026',
    }),
  ];

  const caveats = [];
  if (locationBenchmark.status === 'fallback') {
    caveats.push(locationBenchmark.note);
  }
  if (occupationBenchmark.status !== 'matched') {
    caveats.push(occupationBenchmark.note);
  }
  if (!observedMetricsAvailable) {
    caveats.push('Recent tracked transaction data was too thin to score expense pressure directly.');
  }

  const confidence = calculateConfidence({
    locationStatus: locationBenchmark.status,
    occupationStatus: occupationBenchmark.status,
    observedMetricsAvailable,
  });
  const band = resolveScoreBand(weightedScore);

  return {
    generatedAt: now.toISOString(),
    benchmarkVersion: BENCHMARK_PACK.version,
    score: weightedScore,
    band,
    confidence,
    comparators,
    metrics: {
      age,
      maritalStatus: profile.marital_status,
      location: profile.location,
      mappedLocation: locationBenchmark.label,
      householdSize,
      childrenCount: Number.parseInt(String(profile.children_count || 0), 10) || 0,
      occupation: profile.occupation || null,
      industry: profile.industry || null,
      primaryMonthlyIncome: roundCurrency(incomeMetrics.primaryIncome),
      spouseMonthlyIncome: roundCurrency(incomeMetrics.spouseIncome),
      declaredHouseholdIncome: roundCurrency(incomeMetrics.declaredHouseholdIncome),
      observedLast3Months: observedMetrics,
      officialBenchmarks: {
        nationalAverageSalary: BENCHMARK_PACK.nationalAverageSalary,
        householdGrossIncome: householdBenchmark.grossIncome,
        householdMoneyExpenditure: householdBenchmark.moneyExpenditure,
        localityGrossIncome: locationBenchmark.benchmarkGrossIncome,
        occupationGrossIncome: occupationBenchmark.benchmarkGrossIncome,
      },
    },
    narrative: {
      headline: '',
      summary: '',
      strengths: [],
      risks: [],
      actions: [],
      caveats,
      locale: `${locale || 'en'}`.slice(0, 2),
    },
    sources: BENCHMARK_SOURCES,
  };
}

async function generateNarrative(assessment, locale, openaiApiKey) {
  const response = await createCompletionFn(
    [
      {
        role: 'system',
        content: [
          `You are writing a financial profiling summary for an Israeli finance app.`,
          `Use ${resolveNarrativeLanguage(locale)}.`,
          `Do not change any numeric values, score, band, or confidence.`,
          `Be honest, specific, and balanced.`,
          `Return strict JSON only with keys: headline, summary, strengths, risks, actions, caveats.`,
          `Each array must contain 2 to 4 short strings.`,
        ].join(' '),
      },
      {
        role: 'user',
        content: JSON.stringify({
          score: assessment.score,
          band: assessment.band,
          confidence: assessment.confidence,
          comparators: assessment.comparators,
          metrics: assessment.metrics,
          sources: assessment.sources,
          existingCaveats: assessment.narrative.caveats,
        }),
      },
    ],
    null,
    {
      apiKey: openaiApiKey,
      model: OPENAI_MODEL,
      temperature: 0.2,
      maxTokens: 1200,
      responseFormat: { type: 'json_object' },
    },
  );

  if (!response?.success) {
    const statusByError = {
      auth_error: 401,
      rate_limited: 429,
      timeout: 504,
      server_error: 502,
      context_too_long: 502,
      unknown: 502,
    };
    throw serviceError(
      statusByError[response?.error] || 502,
      response?.userMessage || 'Profiling AI generation failed',
      { code: response?.error || 'unknown' },
    );
  }

  const payload = extractMessageText(response.message?.content);
  const parsed = parseNarrativePayload(payload);
  return {
    ...parsed,
    caveats: Array.from(new Set([...(assessment.narrative.caveats || []), ...parsed.caveats])),
  };
}

async function saveAssessment(client, profileHash, assessment) {
  await client.query(
    `
      INSERT INTO profile_assessments (
        assessment_type,
        profile_hash,
        benchmark_version,
        openai_model,
        generated_at,
        assessment_json,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, datetime('now'), datetime('now'))
      ON CONFLICT(assessment_type) DO UPDATE SET
        profile_hash = excluded.profile_hash,
        benchmark_version = excluded.benchmark_version,
        openai_model = excluded.openai_model,
        generated_at = excluded.generated_at,
        assessment_json = excluded.assessment_json,
        updated_at = datetime('now')
    `,
    [
      ASSESSMENT_TYPE,
      profileHash,
      assessment.benchmarkVersion,
      OPENAI_MODEL,
      assessment.generatedAt,
      JSON.stringify(assessment),
    ],
  );
}

function resolveStaleReasons(savedRow, currentProfileHash, missingFields) {
  const reasons = [];
  if (!savedRow) return reasons;
  if (savedRow.profile_hash !== currentProfileHash) {
    reasons.push('profile_changed');
  }
  if (savedRow.benchmark_version !== BENCHMARK_PACK.version) {
    reasons.push('benchmark_updated');
  }
  if (missingFields.length > 0) {
    reasons.push('profile_incomplete');
  }
  return reasons;
}

async function getProfilingStatus(_params = {}, options = {}) {
  const now = options.now || new Date();
  const client = await databaseAdapter.getClient();

  try {
    const { profile, spouse } = await loadProfileContext(client);
    const missingFields = collectMissingFields(profile, spouse, now);
    const currentProfileHash = buildProfileHash(profile, spouse, now);
    const { row, assessment } = await loadSavedAssessment(client);
    const staleReasons = resolveStaleReasons(row, currentProfileHash, missingFields);

    return {
      missingFields,
      isStale: staleReasons.length > 0,
      staleReasons,
      assessment,
    };
  } finally {
    if (typeof client.release === 'function') {
      client.release();
    }
  }
}

async function generateProfilingAssessment(params = {}, options = {}) {
  const now = options.now || new Date();
  const locale = options.locale || 'en';
  const openaiApiKey = `${params.openaiApiKey || ''}`.trim();
  const force = Boolean(params.force);

  if (!openaiApiKey) {
    throw serviceError(400, 'OpenAI API key is required to generate profiling');
  }

  const client = await databaseAdapter.getClient();

  try {
    const { profile, spouse } = await loadProfileContext(client);
    const missingFields = collectMissingFields(profile, spouse, now);
    if (missingFields.length > 0) {
      throw serviceError(400, 'Complete the required profile fields before generating profiling', {
        missingFields,
      });
    }

    const currentProfileHash = buildProfileHash(profile, spouse, now);
    const { row, assessment: savedAssessment } = await loadSavedAssessment(client);
    const staleReasons = resolveStaleReasons(row, currentProfileHash, missingFields);

    if (savedAssessment && staleReasons.length === 0 && !force) {
      return {
        missingFields,
        isStale: false,
        staleReasons: [],
        assessment: savedAssessment,
      };
    }

    const observedMetrics = await loadObservedMetrics(client, now);
    const assessment = buildProfilingPayload({
      profile,
      spouse,
      observedMetrics,
      locale,
      now,
    });

    assessment.narrative = await generateNarrative(assessment, locale, openaiApiKey);

    await saveAssessment(client, currentProfileHash, assessment);

    return {
      missingFields: [],
      isStale: false,
      staleReasons: [],
      assessment,
    };
  } finally {
    if (typeof client.release === 'function') {
      client.release();
    }
  }
}

function __setDatabase(nextDatabase) {
  if (nextDatabase && typeof nextDatabase.getClient === 'function') {
    databaseAdapter = nextDatabase;
  }
}

function __setCreateCompletion(nextCreateCompletion) {
  if (typeof nextCreateCompletion === 'function') {
    createCompletionFn = nextCreateCompletion;
  }
}

function __resetDependencies() {
  databaseAdapter = database;
  createCompletionFn = openAiClient.createCompletion;
}

module.exports = {
  getProfilingStatus,
  generateProfilingAssessment,
  __setDatabase,
  __setCreateCompletion,
  __resetDependencies,
  utils: {
    BENCHMARK_PACK,
    BENCHMARK_SOURCES,
    buildProfileHash,
    calculateAgeFromBirthDate,
    collectMissingFields,
    resolveLocationBenchmark,
    resolveOccupationBenchmark,
    resolveScoreBand,
    parseNarrativePayload,
    resolveStaleReasons,
  },
};

module.exports.default = module.exports;
