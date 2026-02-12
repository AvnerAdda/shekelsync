import { describe, expect, it } from 'vitest';
import {
  buildChildProfileDelete,
  buildChildProfileUpdate,
  calculateProfileAge,
} from '../enhanced-profile-helpers';

describe('EnhancedProfileSection helpers', () => {
  it('calculates age from birth date and handles empty values', () => {
    expect(calculateProfileAge('', new Date('2026-02-09'))).toBeNull();
    expect(calculateProfileAge('2000-02-10', new Date('2026-02-09'))).toBe(25);
    expect(calculateProfileAge('2000-02-09', new Date('2026-02-09'))).toBe(26);
  });

  it('builds child profile updates for add and edit flows', () => {
    const existingChildren = [
      {
        id: 1,
        name: 'A',
        birth_date: '2015-01-01',
        gender: 'female',
        education_stage: 'elementary',
        special_needs: false,
      },
    ];

    const addResult = buildChildProfileUpdate({
      existingChildren,
      editingChild: null,
      tempChild: {
        name: 'B',
        birth_date: '2018-03-01',
        gender: 'male',
        education_stage: 'preschool',
        special_needs: false,
      } as any,
      hasSpouse: true,
      newChildId: 99,
    });
    expect(addResult.updatedChildren).toHaveLength(2);
    expect(addResult.updatedChildren[1].id).toBe(99);
    expect(addResult.childrenCount).toBe(2);
    expect(addResult.householdSize).toBe(4);

    const editResult = buildChildProfileUpdate({
      existingChildren,
      editingChild: existingChildren[0] as any,
      tempChild: {
        id: 1,
        name: 'A (Edited)',
        birth_date: '2015-01-01',
        gender: 'female',
        education_stage: 'middle_school',
        special_needs: false,
      } as any,
      hasSpouse: false,
      newChildId: 100,
    });
    expect(editResult.updatedChildren).toHaveLength(1);
    expect(editResult.updatedChildren[0].name).toBe('A (Edited)');
    expect(editResult.childrenCount).toBe(1);
    expect(editResult.householdSize).toBe(2);
  });

  it('builds child profile delete state and recalculates household size', () => {
    const result = buildChildProfileDelete({
      existingChildren: [
        {
          id: 1,
          name: 'A',
          birth_date: '2015-01-01',
          gender: 'female',
          education_stage: 'elementary',
          special_needs: false,
        },
        {
          id: 2,
          name: 'B',
          birth_date: '2018-01-01',
          gender: 'male',
          education_stage: 'preschool',
          special_needs: false,
        },
      ] as any,
      childId: 1,
      hasSpouse: true,
    });

    expect(result.updatedChildren).toHaveLength(1);
    expect(result.updatedChildren[0].id).toBe(2);
    expect(result.childrenCount).toBe(1);
    expect(result.householdSize).toBe(3);
  });
});
