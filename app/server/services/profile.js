const database = require('./database.js');

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
  saveProfile,
  utils: {
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
