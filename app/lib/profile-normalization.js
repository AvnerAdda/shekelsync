export const normalizeProfile = (profile = {}) => ({
    id: profile.id ?? undefined,
    username: profile.username ?? '',
    marital_status: profile.marital_status ?? '',
    age: profile.age === null || profile.age === undefined || profile.age === '' ? null : Number(profile.age),
    birth_date: profile.birth_date ?? '',
    occupation: profile.occupation ?? '',
    monthly_income: profile.monthly_income === null || profile.monthly_income === undefined || profile.monthly_income === ''
        ? null
        : Number(profile.monthly_income),
    family_status: profile.family_status ?? '',
    location: profile.location ?? '',
    industry: profile.industry ?? '',
    children_count: profile.children_count === null || profile.children_count === undefined
        ? 0
        : Number(profile.children_count),
    household_size: profile.household_size === null || profile.household_size === undefined
        ? 1
        : Number(profile.household_size),
    home_ownership: profile.home_ownership ?? '',
    education_level: profile.education_level ?? '',
    employment_status: profile.employment_status ?? '',
});
export const normalizeSpouse = (spouse) => {
    if (!spouse) {
        return null;
    }
    return {
        id: spouse.id ?? undefined,
        name: spouse.name ?? '',
        birth_date: spouse.birth_date ?? '',
        occupation: spouse.occupation ?? '',
        industry: spouse.industry ?? '',
        monthly_income: spouse.monthly_income === null || spouse.monthly_income === undefined || spouse.monthly_income === ''
            ? null
            : Number(spouse.monthly_income),
        employment_status: spouse.employment_status ?? '',
        education_level: spouse.education_level ?? '',
    };
};
export const normalizeChildren = (children) => Array.isArray(children)
    ? children.map((child) => ({
        ...child,
        name: child.name ?? '',
        birth_date: child.birth_date ?? '',
        gender: child.gender ?? '',
        education_stage: child.education_stage ?? '',
        special_needs: Boolean(child.special_needs),
    }))
    : [];
