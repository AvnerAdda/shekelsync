import { describe, expect, it } from 'vitest';
import {
  normalizeProfile,
  normalizeSpouse,
  normalizeChildren,
  EnhancedUserProfile,
  SpouseProfile,
  ChildProfile,
} from '../profile-normalization';

describe('profile-normalization', () => {
  it('normalizes missing profile fields to safe defaults', () => {
    const result = normalizeProfile({});

    const expected: Partial<EnhancedUserProfile> = {
      username: '',
      marital_status: '',
      age: null,
      birth_date: '',
      occupation: '',
      monthly_income: null,
      family_status: '',
      location: '',
      industry: '',
      children_count: 0,
      household_size: 1,
      home_ownership: '',
      education_level: '',
      employment_status: '',
    };

    expect(result).toMatchObject(expected);
  });

  it('converts numeric strings to numbers when present', () => {
    const result = normalizeProfile({
      age: '42',
      monthly_income: '12345.67',
      children_count: '3',
      household_size: '5',
    });

    expect(result.age).toBe(42);
    expect(result.monthly_income).toBeCloseTo(12345.67);
    expect(result.children_count).toBe(3);
    expect(result.household_size).toBe(5);
  });

  it('returns null for blank numeric inputs', () => {
    const result = normalizeProfile({
      age: '',
      monthly_income: '',
    });

    expect(result.age).toBeNull();
    expect(result.monthly_income).toBeNull();
  });

  it('normalizes spouse data or returns null when absent', () => {
    expect(normalizeSpouse(undefined)).toBeNull();

    const spouse = normalizeSpouse({
      name: undefined,
      monthly_income: '4200',
      employment_status: null,
    }) as SpouseProfile;

    expect(spouse.name).toBe('');
    expect(spouse.monthly_income).toBe(4200);
    expect(spouse.employment_status).toBe('');
  });

  it('normalizes children arrays and coerces booleans', () => {
    const childResult = normalizeChildren([
      {
        name: null,
        birth_date: undefined,
        gender: '',
        education_stage: null,
        special_needs: 1,
      },
    ]) as ChildProfile[];

    expect(childResult).toHaveLength(1);
    expect(childResult[0]).toMatchObject({
      name: '',
      birth_date: '',
      gender: '',
      education_stage: '',
      special_needs: true,
    });

    expect(normalizeChildren(undefined as any)).toEqual([]);
  });
});
