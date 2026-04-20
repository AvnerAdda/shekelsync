export type SettingsTabId = 'profile' | 'appearance' | 'sync' | 'privacy' | 'system';

export type SettingsTabConfig = {
  id: SettingsTabId;
  labelKey: string;
  canonicalHash: string;
  legacyHashes: string[];
};

export const SETTINGS_TABS: SettingsTabConfig[] = [
  {
    id: 'profile',
    labelKey: 'tabs.profile',
    canonicalHash: 'profile',
    legacyHashes: [],
  },
  {
    id: 'appearance',
    labelKey: 'tabs.appearance',
    canonicalHash: 'appearance',
    legacyHashes: ['language'],
  },
  {
    id: 'sync',
    labelKey: 'tabs.sync',
    canonicalHash: 'sync',
    legacyHashes: [],
  },
  {
    id: 'privacy',
    labelKey: 'tabs.privacySecurity',
    canonicalHash: 'privacy',
    legacyHashes: ['chatbot', 'security'],
  },
  {
    id: 'system',
    labelKey: 'tabs.system',
    canonicalHash: 'system',
    legacyHashes: ['diagnostics', 'about'],
  },
];

export const DEFAULT_SETTINGS_TAB_ID: SettingsTabId = 'profile';

export const SETTINGS_TAB_INDEX_BY_ID = SETTINGS_TABS.reduce<Record<SettingsTabId, number>>((accumulator, tab, index) => {
  accumulator[tab.id] = index;
  return accumulator;
}, {
  profile: 0,
  appearance: 1,
  sync: 2,
  privacy: 3,
  system: 4,
});

const SETTINGS_TAB_ID_BY_HASH = SETTINGS_TABS.reduce<Record<string, SettingsTabId>>((accumulator, tab) => {
  accumulator[tab.canonicalHash] = tab.id;
  for (const legacyHash of tab.legacyHashes) {
    accumulator[legacyHash] = tab.id;
  }
  return accumulator;
}, {});

export const normalizeSettingsHash = (hash: string) => hash.replace(/^#/, '').trim().toLowerCase();

export const resolveSettingsTabIdFromHash = (hash: string): SettingsTabId | null => {
  const normalizedHash = normalizeSettingsHash(hash);
  return normalizedHash ? SETTINGS_TAB_ID_BY_HASH[normalizedHash] ?? null : null;
};

export const resolveSettingsSectionIdFromHash = (hash: string, activeTabId: SettingsTabId): string | null => {
  const normalizedHash = normalizeSettingsHash(hash);
  if (!normalizedHash) {
    return null;
  }

  if (normalizedHash === 'diagnostics') {
    return 'diagnostics';
  }

  if (normalizedHash === 'about') {
    return 'about';
  }

  if (normalizedHash === 'sync' || normalizedHash === 'system') {
    return normalizedHash;
  }

  if (normalizedHash === 'appearance' || normalizedHash === 'language') {
    return normalizedHash;
  }

  if (normalizedHash === 'profile' || normalizedHash === 'chatbot' || normalizedHash === 'privacy' || normalizedHash === 'security') {
    return normalizedHash;
  }

  const activeTab = SETTINGS_TABS.find((tab) => tab.id === activeTabId);
  return activeTab?.canonicalHash ?? null;
};

export const getCanonicalSettingsHash = (tabId: SettingsTabId) => (
  SETTINGS_TABS.find((tab) => tab.id === tabId)?.canonicalHash ?? DEFAULT_SETTINGS_TAB_ID
);
