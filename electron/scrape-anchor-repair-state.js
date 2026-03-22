const sessionStore = require('./session-store');

function normalizeCredentialId(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeCompletedCredentialIds(values = []) {
  if (!Array.isArray(values)) {
    return [];
  }

  return Array.from(new Set(
    values
      .map((value) => normalizeCredentialId(value))
      .filter((value) => value !== null),
  )).sort((left, right) => left - right);
}

async function getRepairSettings() {
  const settings = await sessionStore.getSettings();
  const completedCredentialIds = normalizeCompletedCredentialIds(
    settings?.dataRepair?.scrapeAnchorV1?.completedCredentialIds,
  );

  return {
    settings,
    completedCredentialIds,
  };
}

function createScrapeAnchorRepairStateProvider() {
  return {
    async getCompletedCredentialIds() {
      const { completedCredentialIds } = await getRepairSettings();
      return completedCredentialIds;
    },

    async markCredentialRepairComplete(credentialId) {
      const normalizedCredentialId = normalizeCredentialId(credentialId);
      if (!normalizedCredentialId) {
        return false;
      }

      const { settings, completedCredentialIds } = await getRepairSettings();
      if (completedCredentialIds.includes(normalizedCredentialId)) {
        return false;
      }

      const nextCompletedCredentialIds = [...completedCredentialIds, normalizedCredentialId]
        .sort((left, right) => left - right);

      await sessionStore.updateSettings({
        ...settings,
        dataRepair: {
          ...(settings?.dataRepair || {}),
          scrapeAnchorV1: {
            ...(settings?.dataRepair?.scrapeAnchorV1 || {}),
            completedCredentialIds: nextCompletedCredentialIds,
          },
        },
      });

      return true;
    },
  };
}

module.exports = {
  createScrapeAnchorRepairStateProvider,
  normalizeCompletedCredentialIds,
};

module.exports.default = module.exports;
