export type DashboardHighlightTone = 'default' | 'success' | 'warning';

export interface DashboardHighlightDescriptor {
  key: string;
  priority: 'primary' | 'secondary';
  tone: DashboardHighlightTone;
}

export interface RhythmHighlightInput {
  avgDailySpend: number | null;
  weekendPercentage: number | null;
  peakHour: number | null;
  preciseTimePercentage: number | null;
}

export interface PersonalityHighlightInput {
  impulsePercentage: number;
  programmedPercentage: number;
  programmedAmount: number | null;
  impulseAmount: number | null;
  recurringCount: number | null;
  topCategoryWeekly: number | null;
}

export function buildRhythmHighlightDescriptors(
  input: RhythmHighlightInput,
): DashboardHighlightDescriptor[] {
  const descriptors: DashboardHighlightDescriptor[] = [];

  if (input.avgDailySpend !== null) {
    descriptors.push({ key: 'avgDaily', priority: 'primary', tone: 'default' });
  }

  if (input.weekendPercentage !== null) {
    descriptors.push({
      key: 'weekendShare',
      priority: descriptors.length === 0 ? 'primary' : 'secondary',
      tone: input.weekendPercentage >= 55 ? 'warning' : 'default',
    });
  }

  if (input.peakHour !== null) {
    descriptors.push({
      key: 'peakHour',
      priority: descriptors.length === 0 ? 'primary' : 'secondary',
      tone: 'default',
    });
  }

  if (input.preciseTimePercentage !== null) {
    descriptors.push({
      key: 'preciseTime',
      priority: descriptors.length === 0 ? 'primary' : 'secondary',
      tone: input.preciseTimePercentage < 50 ? 'warning' : 'default',
    });
  }

  return descriptors;
}

export function buildPersonalityHighlightDescriptors(
  input: PersonalityHighlightInput,
): DashboardHighlightDescriptor[] {
  const descriptors: DashboardHighlightDescriptor[] = [];
  const impulsePercentage = Math.round(input.impulsePercentage);
  const programmedPercentage = Math.round(input.programmedPercentage);

  if (impulsePercentage > programmedPercentage) {
    descriptors.push({ key: 'impulse', priority: 'primary', tone: 'warning' });
  } else if (programmedPercentage > impulsePercentage) {
    descriptors.push({ key: 'planned', priority: 'primary', tone: 'success' });
  } else {
    descriptors.push({ key: 'planned', priority: 'primary', tone: 'default' });
  }

  if (input.recurringCount !== null) {
    descriptors.push({ key: 'recurringPatterns', priority: 'secondary', tone: 'default' });
  }

  if (input.topCategoryWeekly !== null) {
    descriptors.push({ key: 'topCategoryWeekly', priority: 'secondary', tone: 'default' });
  }

  if (input.programmedAmount !== null) {
    descriptors.push({ key: 'programmedSpend', priority: 'secondary', tone: 'success' });
  }

  if (input.impulseAmount !== null) {
    descriptors.push({ key: 'impulseSpend', priority: 'secondary', tone: 'warning' });
  }

  return descriptors;
}