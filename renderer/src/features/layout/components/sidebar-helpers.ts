export type AccountSyncStatusColor = 'green' | 'orange' | 'red' | 'never';

export const getAccountSyncStatus = (
  lastSyncDate: Date | null,
  nowMs: number = Date.now(),
): AccountSyncStatusColor => {
  if (!lastSyncDate) return 'never';
  const diffMs = nowMs - lastSyncDate.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);

  if (diffHours < 24) return 'green';
  if (diffHours < 48) return 'orange';
  return 'red';
};

export const formatSidebarLastSync = (
  lastSync: Date | null,
  now: Date,
  labels: {
    never: string;
    daysAgo: (count: number) => string;
    hoursAgo: (count: number) => string;
    minutesAgo: (count: number) => string;
    justNow: string;
  },
): string => {
  if (!lastSync) return labels.never;
  const diff = now.getTime() - lastSync.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return labels.daysAgo(days);
  if (hours > 0) return labels.hoursAgo(hours);
  if (minutes > 0) return labels.minutesAgo(minutes);
  return labels.justNow;
};

export const formatSidebarAccountLastSync = (
  lastSync: Date | null,
  now: Date,
  labels: {
    neverSynced: string;
    daysAgo: (count: number) => string;
    hoursAgo: (count: number) => string;
    minutesAgo: (count: number) => string;
    yesterday: string;
    justNow: string;
  },
): string => {
  if (!lastSync) return labels.neverSynced;
  const diff = now.getTime() - lastSync.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 1) return labels.daysAgo(days);
  if (days === 1) return labels.yesterday;
  if (hours > 0) return labels.hoursAgo(hours);
  if (minutes > 0) return labels.minutesAgo(minutes);
  return labels.justNow;
};
