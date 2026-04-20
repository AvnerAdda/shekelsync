const database = require('./database.js');
const { BANK_CATEGORY_NAME } = require('../../lib/category-constants.js');

const INCOME_SUGGESTION_WINDOW_MONTHS = 6;
const MIN_CONFIDENT_INCOME_MONTHS = 4;
const SALARY_KEYWORDS = ['salary', 'salaire', 'משכורת', 'שכר'];

function serviceError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function toNullable(value, fallback = null) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  return value;
}

function toNullableNumber(value, fallback = null) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toNonNegativeInt(value, fallback = 0) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isFinite(parsed) && parsed >= 0) {
    return parsed;
  }
  return fallback;
}

function normalizeText(value) {
  return `${value ?? ''}`
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s_-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function roundCurrency(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.round(value);
}

function addUtcMonths(date, delta) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + delta, 1));
}

function formatMonthKey(date) {
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0');
  return `${year}-${month}`;
}

function getCompletedMonthWindow(now = new Date(), monthCount = INCOME_SUGGESTION_WINDOW_MONTHS) {
  const currentMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const startDate = addUtcMonths(currentMonthStart, -monthCount);
  const endDate = new Date(Date.UTC(currentMonthStart.getUTCFullYear(), currentMonthStart.getUTCMonth(), 0));
  const monthKeys = [];

  for (let index = monthCount; index >= 1; index -= 1) {
    monthKeys.push(formatMonthKey(addUtcMonths(currentMonthStart, -index)));
  }

  return {
    startDate: startDate.toISOString().slice(0, 10),
    endDate: endDate.toISOString().slice(0, 10),
    monthKeys,
  };
}

function median(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }

  return sorted[middle];
}

function coefficientOfVariation(values) {
  if (!Array.isArray(values) || values.length < 2) {
    return 0;
  }

  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (!(mean > 0)) {
    return Number.POSITIVE_INFINITY;
  }

  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length;
  return Math.sqrt(variance) / mean;
}

function isSalaryLikeRow(row) {
  const haystacks = [
    row?.category_name,
    row?.category_name_en,
    row?.category_name_fr,
    row?.parent_category_name,
    row?.parent_category_name_en,
    row?.parent_category_name_fr,
  ]
    .map(normalizeText)
    .filter(Boolean);

  return haystacks.some((value) => SALARY_KEYWORDS.some((keyword) => value.includes(normalizeText(keyword))));
}

function buildMonthlyTotals(rows, monthKeys) {
  const monthlyTotals = new Map(
    monthKeys.map((monthKey) => [monthKey, { income: 0, salary: 0 }]),
  );

  rows.forEach((row) => {
    const monthKey = `${row?.date ?? ''}`.slice(0, 7);
    const amount = Number.parseFloat(row?.price || 0);

    if (!monthlyTotals.has(monthKey) || !(amount > 0)) {
      return;
    }

    const bucket = monthlyTotals.get(monthKey);
    bucket.income += amount;

    if (isSalaryLikeRow(row)) {
      bucket.salary += amount;
    }
  });

  return monthKeys.map((monthKey) => ({
    monthKey,
    income: roundCurrency(monthlyTotals.get(monthKey)?.income || 0),
    salary: roundCurrency(monthlyTotals.get(monthKey)?.salary || 0),
  }));
}

function buildConfidentIncomeSuggestion({ profile, spouse, rows, now = new Date() }) {
  const maritalStatus = `${profile?.marital_status || ''}`.trim().toLowerCase();
  const employmentStatus = `${profile?.employment_status || ''}`.trim().toLowerCase();

  if (maritalStatus === 'married' || spouse) {
    return null;
  }

  if (employmentStatus === 'retired' || employmentStatus === 'student' || employmentStatus === 'unemployed') {
    return null;
  }

  const window = getCompletedMonthWindow(now);
  const monthlyTotals = buildMonthlyTotals(rows, window.monthKeys);
  const incomeTotals = monthlyTotals.map((item) => item.income).filter((value) => value > 0);
  const salaryTotals = monthlyTotals.map((item) => item.salary).filter((value) => value > 0);

  const salaryAmount = roundCurrency(median(salaryTotals));
  const incomeAmount = roundCurrency(median(incomeTotals));
  const salaryVariation = coefficientOfVariation(salaryTotals);
  const incomeVariation = coefficientOfVariation(incomeTotals);

  const hasHighConfidenceSalary = (
    salaryAmount > 0
    && salaryTotals.length >= MIN_CONFIDENT_INCOME_MONTHS
    && salaryVariation <= 0.3
  );

  if (hasHighConfidenceSalary) {
    return {
      amount: salaryAmount,
      basis: 'salary',
      confidence: 'high',
      isNetEstimate: true,
      monthsAnalyzed: window.monthKeys.length,
      activeMonths: salaryTotals.length,
      detectedMonthlySalary: salaryAmount,
      detectedMonthlyIncome: incomeAmount,
      periodStart: window.startDate,
      periodEnd: window.endDate,
    };
  }

  const hasHighConfidenceIncome = (
    employmentStatus === 'self_employed'
    && incomeAmount > 0
    && incomeTotals.length >= MIN_CONFIDENT_INCOME_MONTHS
    && incomeVariation <= 0.3
  );

  if (hasHighConfidenceIncome) {
    return {
      amount: incomeAmount,
      basis: 'income',
      confidence: 'high',
      isNetEstimate: true,
      monthsAnalyzed: window.monthKeys.length,
      activeMonths: incomeTotals.length,
      detectedMonthlySalary: salaryAmount,
      detectedMonthlyIncome: incomeAmount,
      periodStart: window.startDate,
      periodEnd: window.endDate,
    };
  }

  return null;
}

async function getProfile() {
  const client = await database.getClient();

  try {
    const profileResult = await client.query('SELECT * FROM user_profile LIMIT 1');

    if (profileResult.rows.length === 0) {
      const inserted = await client.query(
        `INSERT INTO user_profile (username, marital_status, age, location)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        ['User', 'Single', 28, 'Tel Aviv'],
      );

      return {
        profile: inserted.rows[0],
        spouse: null,
        children: [],
      };
    }

    const profile = profileResult.rows[0];
    const profileId = profile.id;

    const spouseResult = await client.query(
      'SELECT * FROM spouse_profile WHERE user_profile_id = $1',
      [profileId],
    );
    const spouse = spouseResult.rows.length > 0 ? spouseResult.rows[0] : null;

    const childrenResult = await client.query(
      'SELECT * FROM children_profile WHERE user_profile_id = $1 ORDER BY birth_date ASC',
      [profileId],
    );

    return {
      profile,
      spouse,
      children: childrenResult.rows,
    };
  } finally {
    client.release();
  }
}

async function getIncomeSuggestion(now = new Date()) {
  const client = await database.getClient();

  try {
    const profileResult = await client.query('SELECT * FROM user_profile LIMIT 1');
    const profile = profileResult.rows[0] || null;
    const spouse = profile?.id
      ? ((await client.query('SELECT * FROM spouse_profile WHERE user_profile_id = $1 LIMIT 1', [profile.id])).rows[0] || null)
      : null;

    const window = getCompletedMonthWindow(now);
    const transactionsResult = await client.query(
      `
        SELECT
          t.date,
          t.price,
          COALESCE(cd.name, '') AS category_name,
          COALESCE(cd.name_en, '') AS category_name_en,
          COALESCE(cd.name_fr, '') AS category_name_fr,
          COALESCE(parent_cd.name, '') AS parent_category_name,
          COALESCE(parent_cd.name_en, '') AS parent_category_name_en,
          COALESCE(parent_cd.name_fr, '') AS parent_category_name_fr
        FROM transactions t
        LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
        LEFT JOIN category_definitions parent_cd ON parent_cd.id = cd.parent_id
        LEFT JOIN (
          SELECT DISTINCT transaction_identifier, transaction_vendor
          FROM transaction_pairing_exclusions
        ) tpe
          ON t.identifier = tpe.transaction_identifier
          AND t.vendor = tpe.transaction_vendor
        WHERE t.date >= $1
          AND t.date <= $2
          AND t.price > 0
          AND tpe.transaction_identifier IS NULL
          AND (
            (cd.category_type = 'income' AND COALESCE(cd.is_counted_as_income, 1) = 1)
            OR (cd.category_type IS NULL)
            OR (COALESCE(cd.name, '') = $3)
          )
      `,
      [window.startDate, window.endDate, BANK_CATEGORY_NAME],
    );

    return {
      suggestion: buildConfidentIncomeSuggestion({
        profile,
        spouse,
        rows: transactionsResult.rows,
        now,
      }),
    };
  } finally {
    client.release();
  }
}

async function saveProfile(payload = {}) {
  const { profile: profileData, spouse: spouseData, children: childrenData } = payload;

  if (!profileData) {
    throw serviceError(400, 'Profile data is required');
  }

  const client = await database.getClient();
  const inferredChildrenCount = toNonNegativeInt(
    profileData.children_count,
    Array.isArray(childrenData) ? childrenData.length : 0,
  );
  const inferredHouseholdSize = toNonNegativeInt(
    profileData.household_size,
    Array.isArray(childrenData) ? 1 + childrenData.length : 1,
  );

  try {
    await client.query('BEGIN');

    const existingProfile = await client.query('SELECT id FROM user_profile LIMIT 1');
    let profileId;
    let updatedProfile;

    if (existingProfile.rows.length === 0) {
      const insertResult = await client.query(
        `INSERT INTO user_profile (
           username,
           marital_status,
           age,
           birth_date,
           occupation,
           monthly_income,
           family_status,
           location,
           industry,
           children_count,
           household_size,
           home_ownership,
           education_level,
           employment_status
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         RETURNING *`,
        [
          toNullable(profileData.username, 'User'),
          toNullable(profileData.marital_status, 'Single'),
          toNullableNumber(profileData.age, null),
          toNullable(profileData.birth_date),
          toNullable(profileData.occupation),
          toNullableNumber(profileData.monthly_income),
          toNullable(profileData.family_status),
          toNullable(profileData.location),
          toNullable(profileData.industry),
          inferredChildrenCount,
          inferredHouseholdSize,
          toNullable(profileData.home_ownership),
          toNullable(profileData.education_level),
          toNullable(profileData.employment_status),
        ],
      );
      updatedProfile = insertResult.rows[0];
      profileId = updatedProfile.id;
    } else {
      profileId = existingProfile.rows[0].id;
      const updateResult = await client.query(
        `UPDATE user_profile
            SET username = $1,
                marital_status = $2,
                age = $3,
                birth_date = $4,
                occupation = $5,
                monthly_income = $6,
                family_status = $7,
                location = $8,
                industry = $9,
                home_ownership = $10,
                education_level = $11,
                employment_status = $12,
                children_count = $13,
                household_size = $14,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $15
          RETURNING *`,
        [
          toNullable(profileData.username, 'User'),
          toNullable(profileData.marital_status, 'Single'),
          toNullableNumber(profileData.age, null),
          toNullable(profileData.birth_date),
          toNullable(profileData.occupation),
          toNullableNumber(profileData.monthly_income),
          toNullable(profileData.family_status),
          toNullable(profileData.location),
          toNullable(profileData.industry),
          toNullable(profileData.home_ownership),
          toNullable(profileData.education_level),
          toNullable(profileData.employment_status),
          inferredChildrenCount,
          inferredHouseholdSize,
          profileId,
        ],
      );
      updatedProfile = updateResult.rows[0];
    }

    let updatedSpouse = null;
    if (profileData.marital_status === 'Married' && spouseData) {
      const existingSpouse = await client.query(
        'SELECT id FROM spouse_profile WHERE user_profile_id = $1',
        [profileId],
      );

      if (existingSpouse.rows.length === 0) {
        const spouseInsert = await client.query(
          `INSERT INTO spouse_profile (
             user_profile_id,
             name,
             birth_date,
             occupation,
             industry,
             monthly_income,
             employment_status,
             education_level
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING *`,
          [
            profileId,
            spouseData.name,
            spouseData.birth_date,
            spouseData.occupation,
            spouseData.industry,
            spouseData.monthly_income,
            spouseData.employment_status,
            spouseData.education_level,
          ],
        );
        updatedSpouse = spouseInsert.rows[0];
      } else {
        const spouseUpdate = await client.query(
          `UPDATE spouse_profile
              SET name = $1,
                  birth_date = $2,
                  occupation = $3,
                  industry = $4,
                  monthly_income = $5,
                  employment_status = $6,
                  education_level = $7,
                  updated_at = CURRENT_TIMESTAMP
            WHERE user_profile_id = $8
            RETURNING *`,
          [
            toNullable(spouseData.name),
            toNullable(spouseData.birth_date),
            toNullable(spouseData.occupation),
            toNullable(spouseData.industry),
            toNullableNumber(spouseData.monthly_income),
            toNullable(spouseData.employment_status),
            toNullable(spouseData.education_level),
            profileId,
          ],
        );
        updatedSpouse = spouseUpdate.rows[0];
      }
    } else {
      await client.query('DELETE FROM spouse_profile WHERE user_profile_id = $1', [profileId]);
    }

    let updatedChildren = [];
    await client.query('DELETE FROM children_profile WHERE user_profile_id = $1', [profileId]);
    if (Array.isArray(childrenData)) {
      for (const child of childrenData) {
        if (!child.birth_date) {
          // Skip invalid child records
          // eslint-disable-next-line no-continue
          continue;
        }

        const childResult = await client.query(
          `INSERT INTO children_profile (
             user_profile_id,
             name,
             birth_date,
             gender,
             education_stage,
             special_needs
           ) VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING *`,
          [
            profileId,
            toNullable(child.name),
            toNullable(child.birth_date),
            toNullable(child.gender),
            toNullable(child.education_stage),
            child.special_needs ? 1 : 0,
          ],
        );
        updatedChildren.push(childResult.rows[0]);
      }
    }

    await client.query('COMMIT');

    return {
      profile: updatedProfile,
      spouse: updatedSpouse,
      children: updatedChildren,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  getProfile,
  getIncomeSuggestion,
  saveProfile,
  utils: {
    buildConfidentIncomeSuggestion,
    coefficientOfVariation,
    getCompletedMonthWindow,
    isSalaryLikeRow,
    median,
    normalizeText,
    roundCurrency,
    serviceError,
    toNullable,
    toNullableNumber,
    toNonNegativeInt,
  },
  __setDatabaseForTests(overrides = {}) {
    Object.assign(database, overrides);
  },
};

module.exports.default = module.exports;
