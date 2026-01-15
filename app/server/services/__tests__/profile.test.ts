import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const profileServiceModulePromise = import('../profile.js');

let profileService: any;

const queryMock = vi.fn();
const releaseMock = vi.fn();
const mockClient = { query: queryMock, release: releaseMock };
const getClientMock = vi.fn(async () => mockClient);

beforeAll(async () => {
  profileService = (await profileServiceModulePromise).default;
});

describe('profile service helpers', () => {
  it('toNullable returns fallback for emptyish values', () => {
    const { toNullable } = profileService.utils;
    expect(toNullable(undefined, 'x')).toBe('x');
    expect(toNullable('', 'y')).toBe('y');
    expect(toNullable(null, 'z')).toBe('z');
    expect(toNullable('value', 'fallback')).toBe('value');
  });

  it('toNullableNumber parses finite numbers or returns fallback', () => {
    const { toNullableNumber } = profileService.utils;
    expect(toNullableNumber('42')).toBe(42);
    expect(toNullableNumber('')).toBeNull();
    expect(toNullableNumber('foo', 10)).toBe(10);
  });

  it('toNonNegativeInt coerces to non-negative integers', () => {
    const { toNonNegativeInt } = profileService.utils;
    expect(toNonNegativeInt('5')).toBe(5);
    expect(toNonNegativeInt(-2, 3)).toBe(3);
    expect(toNonNegativeInt('', 1)).toBe(1);
  });

  it('toNullable returns 0 and false correctly', () => {
    const { toNullable } = profileService.utils;
    expect(toNullable(0, 'fallback')).toBe(0);
    expect(toNullable(false, 'fallback')).toBe(false);
  });

  it('toNullableNumber handles Infinity and NaN', () => {
    const { toNullableNumber } = profileService.utils;
    expect(toNullableNumber(Infinity, 99)).toBe(99);
    expect(toNullableNumber(-Infinity, 99)).toBe(99);
    expect(toNullableNumber(NaN, 99)).toBe(99);
    expect(toNullableNumber('not a number', 50)).toBe(50);
  });

  it('toNonNegativeInt handles floats and edge cases', () => {
    const { toNonNegativeInt } = profileService.utils;
    expect(toNonNegativeInt('5.7')).toBe(5); // parseInt truncates
    expect(toNonNegativeInt(10.9, 0)).toBe(10);
    expect(toNonNegativeInt(-5, 0)).toBe(0);
    expect(toNonNegativeInt(null, 2)).toBe(2);
    expect(toNonNegativeInt(undefined, 3)).toBe(3);
  });
});

describe('profile service saveProfile', () => {
  beforeEach(() => {
    queryMock.mockReset();
    releaseMock.mockReset();
    getClientMock.mockClear();
    profileService.__setDatabaseForTests({ getClient: getClientMock });
  });

  it('inserts a new profile when none exists', async () => {
    queryMock.mockImplementation(async (text) => {
      if (text === 'BEGIN' || text === 'COMMIT') {
        return { rows: [] };
      }

      if (text.startsWith('SELECT id FROM user_profile')) {
        return { rows: [] };
      }

      if (text.startsWith('INSERT INTO user_profile')) {
        return {
          rows: [
            {
              id: 1,
              username: 'Alice',
              marital_status: 'Single',
              household_size: 1,
            },
          ],
        };
      }

      if (text.startsWith('SELECT id FROM spouse_profile')) {
        return { rows: [] };
      }

      if (text.startsWith('SELECT id, name FROM children_profile')) {
        return { rows: [] };
      }

      return { rows: [] };
    });

    const payload = {
      profile: {
        username: 'Alice',
        marital_status: 'Single',
        age: 30,
        household_size: '',
        children_count: '',
      },
      spouse: null,
      children: [],
    };

    const result = await profileService.saveProfile(payload);

    expect(getClientMock).toHaveBeenCalledTimes(1);
    expect(queryMock).toHaveBeenCalledWith('BEGIN');
    expect(
      queryMock.mock.calls.some(([text]) => String(text).startsWith('INSERT INTO user_profile')),
    ).toBe(true);
    expect(queryMock).toHaveBeenCalledWith('COMMIT');
    expect(releaseMock).toHaveBeenCalledTimes(1);
    expect(result.profile.username).toBe('Alice');
    expect(result.spouse).toBeNull();
    expect(result.children).toEqual([]);
  });

  it('updates existing profile and upserts spouse and children', async () => {
    const insertedChildren: any[] = [];

    queryMock.mockImplementation(async (text, params) => {
      const sql = String(text).trim();

      if (sql === 'BEGIN' || sql === 'COMMIT') {
        return { rows: [] };
      }

      if (sql.startsWith('SELECT id FROM user_profile')) {
        return { rows: [{ id: 42 }] };
      }

      if (sql.startsWith('UPDATE user_profile')) {
        return {
          rows: [
            {
              id: 42,
              username: params?.[0] ?? 'Updated User',
              marital_status: params?.[1] ?? 'Married',
            },
          ],
        };
      }

      if (sql.startsWith('SELECT id FROM spouse_profile')) {
        return { rows: [] };
      }

      if (sql.startsWith('INSERT INTO spouse_profile')) {
        return {
          rows: [
            {
              id: 7,
              user_profile_id: 42,
              name: params?.[1],
              monthly_income: params?.[5],
            },
          ],
        };
      }

      if (sql.startsWith('DELETE FROM children_profile')) {
        return { rowCount: 1 };
      }

      if (sql.startsWith('INSERT INTO children_profile')) {
        insertedChildren.push(params);
        return {
          rows: [
            {
              id: insertedChildren.length,
              name: params?.[1],
              birth_date: params?.[2],
            },
          ],
        };
      }

      return { rows: [] };
    });

    const payload = {
      profile: {
        username: 'Maria',
        marital_status: 'Married',
        children_count: '',
        household_size: '',
      },
      spouse: {
        name: 'Jon',
        monthly_income: '11250',
        employment_status: 'Employed',
      },
      children: [
        { name: 'Kid 1', birth_date: '2018-02-03', gender: 'M' },
        { name: 'Kid 2', birth_date: '', gender: 'F' }, // skipped
      ],
    };

    const result = await profileService.saveProfile(payload);

    expect(getClientMock).toHaveBeenCalledTimes(1);
    expect(queryMock).toHaveBeenCalledWith('BEGIN');
    expect(
      queryMock.mock.calls.some(([text]) => String(text).startsWith('UPDATE user_profile')),
    ).toBe(true);
    expect(
      queryMock.mock.calls.some(([text]) => String(text).startsWith('INSERT INTO spouse_profile')),
    ).toBe(true);
    expect(insertedChildren.length).toBe(1);
    expect(result.profile.username).toBe('Maria');
    expect(result.spouse?.name).toBe('Jon');
    expect(result.children).toHaveLength(1);
    expect(queryMock).toHaveBeenCalledWith('COMMIT');
  });

  it('removes spouse when profile is not married', async () => {
    let deletedSpouse = false;

    queryMock.mockImplementation(async (text) => {
      const sql = String(text).trim();

      if (sql === 'BEGIN' || sql === 'COMMIT') {
        return { rows: [] };
      }

      if (sql.startsWith('SELECT id FROM user_profile')) {
        return { rows: [{ id: 5 }] };
      }

      if (sql.startsWith('UPDATE user_profile')) {
        return { rows: [{ id: 5, marital_status: 'Single' }] };
      }

      if (sql.startsWith('DELETE FROM spouse_profile')) {
        deletedSpouse = true;
        return { rowCount: 1 };
      }

      if (sql.startsWith('DELETE FROM children_profile')) {
        return { rowCount: 0 };
      }

      return { rows: [] };
    });

    await profileService.saveProfile({
      profile: {
        marital_status: 'Single',
        children_count: '',
        household_size: '',
      },
    });

    expect(deletedSpouse).toBe(true);
    expect(queryMock).toHaveBeenCalledWith('COMMIT');
  });

  it('rolls back and rethrows errors', async () => {
    const failure = new Error('db exploded');
    let rolledBack = false;

    queryMock.mockImplementation(async (text) => {
      const sql = String(text).trim();

      if (sql === 'BEGIN') {
        return { rows: [] };
      }

      if (sql.startsWith('SELECT id FROM user_profile')) {
        return { rows: [{ id: 1 }] };
      }

      if (sql.startsWith('UPDATE user_profile')) {
        throw failure;
      }

      if (sql === 'ROLLBACK') {
        rolledBack = true;
        return { rows: [] };
      }

      return { rows: [] };
    });

    await expect(
      profileService.saveProfile({
        profile: { username: 'Oops' },
      }),
    ).rejects.toThrow('db exploded');

    expect(rolledBack).toBe(true);
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('throws 400 when profile data is missing', async () => {
    await expect(profileService.saveProfile({})).rejects.toMatchObject({
      status: 400,
      message: 'Profile data is required',
    });
  });

  it('updates existing spouse when profile is married', async () => {
    queryMock.mockImplementation(async (text, params) => {
      const sql = String(text).trim();

      if (sql === 'BEGIN' || sql === 'COMMIT') {
        return { rows: [] };
      }

      if (sql.startsWith('SELECT id FROM user_profile')) {
        return { rows: [{ id: 10 }] };
      }

      if (sql.startsWith('UPDATE user_profile')) {
        return {
          rows: [
            {
              id: 10,
              username: 'UpdatedUser',
              marital_status: 'Married',
            },
          ],
        };
      }

      if (sql.startsWith('SELECT id FROM spouse_profile')) {
        return { rows: [{ id: 5 }] };
      }

      if (sql.startsWith('UPDATE spouse_profile')) {
        return {
          rows: [
            {
              id: 5,
              user_profile_id: 10,
              name: 'UpdatedSpouse',
              occupation: params?.[2],
            },
          ],
        };
      }

      if (sql.startsWith('DELETE FROM children_profile')) {
        return { rowCount: 0 };
      }

      return { rows: [] };
    });

    const result = await profileService.saveProfile({
      profile: {
        username: 'UpdatedUser',
        marital_status: 'Married',
      },
      spouse: {
        name: 'UpdatedSpouse',
        occupation: 'Engineer',
      },
    });

    expect(result.spouse?.name).toBe('UpdatedSpouse');
    expect(queryMock).toHaveBeenCalledWith('COMMIT');
  });

  it('saves children with special needs flag', async () => {
    const insertedChildren: any[] = [];

    queryMock.mockImplementation(async (text, params) => {
      const sql = String(text).trim();

      if (sql === 'BEGIN' || sql === 'COMMIT') {
        return { rows: [] };
      }

      if (sql.startsWith('SELECT id FROM user_profile')) {
        return { rows: [{ id: 15 }] };
      }

      if (sql.startsWith('UPDATE user_profile')) {
        return { rows: [{ id: 15, marital_status: 'Single' }] };
      }

      if (sql.startsWith('DELETE FROM spouse_profile')) {
        return { rowCount: 0 };
      }

      if (sql.startsWith('DELETE FROM children_profile')) {
        return { rowCount: 0 };
      }

      if (sql.startsWith('INSERT INTO children_profile')) {
        const child = {
          id: insertedChildren.length + 1,
          name: params?.[1],
          special_needs: params?.[5],
        };
        insertedChildren.push(child);
        return { rows: [child] };
      }

      return { rows: [] };
    });

    const result = await profileService.saveProfile({
      profile: {
        marital_status: 'Single',
      },
      children: [
        { name: 'Child1', birth_date: '2020-01-01', special_needs: true },
        { name: 'Child2', birth_date: '2018-05-15', special_needs: false },
      ],
    });

    expect(result.children).toHaveLength(2);
    expect(insertedChildren[0].special_needs).toBe(1);
    expect(insertedChildren[1].special_needs).toBe(0);
  });

  it('saves profile with all optional fields populated', async () => {
    queryMock.mockImplementation(async (text, params) => {
      const sql = String(text).trim();

      if (sql === 'BEGIN' || sql === 'COMMIT') {
        return { rows: [] };
      }

      if (sql.startsWith('SELECT id FROM user_profile')) {
        return { rows: [] };
      }

      if (sql.startsWith('INSERT INTO user_profile')) {
        return {
          rows: [
            {
              id: 20,
              username: params?.[0],
              marital_status: params?.[1],
              age: params?.[2],
              birth_date: params?.[3],
              occupation: params?.[4],
              monthly_income: params?.[5],
              family_status: params?.[6],
              location: params?.[7],
              industry: params?.[8],
              home_ownership: params?.[11],
              education_level: params?.[12],
              employment_status: params?.[13],
            },
          ],
        };
      }

      if (sql.startsWith('DELETE FROM children_profile')) {
        return { rowCount: 0 };
      }

      return { rows: [] };
    });

    const result = await profileService.saveProfile({
      profile: {
        username: 'Complete User',
        marital_status: 'Single',
        age: 35,
        birth_date: '1990-01-01',
        occupation: 'Software Engineer',
        monthly_income: 25000,
        family_status: 'Independent',
        location: 'Haifa',
        industry: 'Technology',
        home_ownership: 'Own',
        education_level: 'Masters',
        employment_status: 'Employed',
      },
    });

    expect(result.profile.username).toBe('Complete User');
    expect(result.profile.occupation).toBe('Software Engineer');
    expect(result.profile.monthly_income).toBe(25000);
  });

  it('infers household_size from children count', async () => {
    let insertedHouseholdSize: any;

    queryMock.mockImplementation(async (text, params) => {
      const sql = String(text).trim();

      if (sql === 'BEGIN' || sql === 'COMMIT') {
        return { rows: [] };
      }

      if (sql.startsWith('SELECT id FROM user_profile')) {
        return { rows: [] };
      }

      if (sql.startsWith('INSERT INTO user_profile')) {
        insertedHouseholdSize = params?.[10]; // household_size param
        return { rows: [{ id: 25, household_size: insertedHouseholdSize }] };
      }

      if (sql.startsWith('DELETE FROM children_profile')) {
        return { rowCount: 0 };
      }

      if (sql.startsWith('INSERT INTO children_profile')) {
        return {
          rows: [{ id: 1, name: params?.[1], birth_date: params?.[2] }],
        };
      }

      return { rows: [] };
    });

    await profileService.saveProfile({
      profile: {
        username: 'Parent',
        marital_status: 'Single',
        household_size: '', // Empty string should trigger inference
      },
      children: [
        { name: 'Kid1', birth_date: '2020-01-01' },
        { name: 'Kid2', birth_date: '2018-05-15' },
      ],
    });

    // household_size should be 1 (parent) + 2 (children) = 3
    expect(insertedHouseholdSize).toBe(3);
  });

  it('skips children without birth_date', async () => {
    const insertedChildren: any[] = [];

    queryMock.mockImplementation(async (text, params) => {
      const sql = String(text).trim();

      if (sql === 'BEGIN' || sql === 'COMMIT') {
        return { rows: [] };
      }

      if (sql.startsWith('SELECT id FROM user_profile')) {
        return { rows: [{ id: 30 }] };
      }

      if (sql.startsWith('UPDATE user_profile')) {
        return { rows: [{ id: 30 }] };
      }

      if (sql.startsWith('DELETE FROM spouse_profile')) {
        return { rowCount: 0 };
      }

      if (sql.startsWith('DELETE FROM children_profile')) {
        return { rowCount: 0 };
      }

      if (sql.startsWith('INSERT INTO children_profile')) {
        insertedChildren.push(params);
        return { rows: [{ id: insertedChildren.length }] };
      }

      return { rows: [] };
    });

    const result = await profileService.saveProfile({
      profile: { username: 'Test', marital_status: 'Single' },
      children: [
        { name: 'Valid', birth_date: '2020-01-01' },
        { name: 'Invalid', birth_date: '' }, // Should be skipped
        { name: 'Also Invalid', birth_date: null }, // Should be skipped
      ],
    });

    expect(result.children).toHaveLength(1);
    expect(insertedChildren).toHaveLength(1);
  });
});

describe('profile service getProfile', () => {
  beforeEach(() => {
    queryMock.mockReset();
    releaseMock.mockReset();
    getClientMock.mockReset();
    profileService.__setDatabaseForTests({ getClient: getClientMock });
  });

  it('creates a default profile when none exist', async () => {
    queryMock.mockImplementation(async (text) => {
      const sql = String(text).trim();

      if (sql.startsWith('SELECT * FROM user_profile')) {
        return { rows: [] };
      }

      if (sql.startsWith('INSERT INTO user_profile')) {
        return {
          rows: [
            {
              id: 99,
              username: 'User',
              marital_status: 'Single',
            },
          ],
        };
      }

      return { rows: [] };
    });

    const result = await profileService.getProfile();

    expect(getClientMock).toHaveBeenCalledTimes(1);
    expect(result.profile.username).toBe('User');
    expect(result.spouse).toBeNull();
    expect(result.children).toEqual([]);
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('returns existing profile with spouse and children', async () => {
    queryMock.mockImplementation(async (text, params) => {
      const sql = String(text).trim();

      if (sql.startsWith('SELECT * FROM user_profile')) {
        return {
          rows: [
            {
              id: 77,
              username: 'Existing',
            },
          ],
        };
      }

      if (sql.startsWith('SELECT * FROM spouse_profile')) {
        expect(params).toEqual([77]);
        return {
          rows: [
            {
              id: 3,
              user_profile_id: 77,
              name: 'Partner',
            },
          ],
        };
      }

      if (sql.startsWith('SELECT * FROM children_profile')) {
        expect(params).toEqual([77]);
        return {
          rows: [
            { id: 1, user_profile_id: 77, name: 'Child1' },
            { id: 2, user_profile_id: 77, name: 'Child2' },
          ],
        };
      }

      return { rows: [] };
    });

    const result = await profileService.getProfile();

    expect(result.profile.id).toBe(77);
    expect(result.spouse?.name).toBe('Partner');
    expect(result.children).toHaveLength(2);
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('releases client on error', async () => {
    queryMock.mockRejectedValue(new Error('Database error'));

    await expect(profileService.getProfile()).rejects.toThrow('Database error');

    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('returns profile with no spouse when spouse table is empty', async () => {
    queryMock.mockImplementation(async (text) => {
      const sql = String(text).trim();

      if (sql.startsWith('SELECT * FROM user_profile')) {
        return { rows: [{ id: 1, username: 'Solo' }] };
      }

      if (sql.startsWith('SELECT * FROM spouse_profile')) {
        return { rows: [] };
      }

      if (sql.startsWith('SELECT * FROM children_profile')) {
        return { rows: [] };
      }

      return { rows: [] };
    });

    const result = await profileService.getProfile();

    expect(result.profile.username).toBe('Solo');
    expect(result.spouse).toBeNull();
    expect(result.children).toEqual([]);
  });
});
