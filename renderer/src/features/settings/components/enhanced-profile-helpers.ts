import { ChildProfile } from '@/lib/profile-normalization';

export const calculateProfileAge = (
  birthDate: string,
  now: Date = new Date(),
): number | null => {
  if (!birthDate) return null;
  const birth = new Date(birthDate);
  let age = now.getFullYear() - birth.getFullYear();
  const monthDiff = now.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) {
    age--;
  }
  return age;
};

export const buildChildProfileUpdate = ({
  existingChildren,
  editingChild,
  tempChild,
  hasSpouse,
  newChildId,
}: {
  existingChildren: ChildProfile[];
  editingChild: ChildProfile | null;
  tempChild: ChildProfile;
  hasSpouse: boolean;
  newChildId: number;
}) => {
  const updatedChildren = editingChild
    ? existingChildren.map((child) =>
        child.id === editingChild.id ? { ...tempChild } : child,
      )
    : [...existingChildren, { ...tempChild, id: newChildId }];

  return {
    updatedChildren,
    childrenCount: updatedChildren.length,
    householdSize: 1 + (hasSpouse ? 1 : 0) + updatedChildren.length,
  };
};

export const buildChildProfileDelete = ({
  existingChildren,
  childId,
  hasSpouse,
}: {
  existingChildren: ChildProfile[];
  childId: number;
  hasSpouse: boolean;
}) => {
  const updatedChildren = existingChildren.filter((child) => child.id !== childId);
  return {
    updatedChildren,
    childrenCount: updatedChildren.length,
    householdSize: 1 + (hasSpouse ? 1 : 0) + updatedChildren.length,
  };
};
