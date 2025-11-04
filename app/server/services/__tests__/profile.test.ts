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
});
