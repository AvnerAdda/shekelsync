const path = require('node:path');

const DEVELOPMENT_DIRECTORY_NAME = 'ShekelSync Development';

function configureUserDataScope(electronApp, options = {}) {
  if (!electronApp || electronApp.isPackaged !== false) {
    return electronApp?.getPath?.('userData') || null;
  }
  if (typeof electronApp.getPath !== 'function' || typeof electronApp.setPath !== 'function') {
    return null;
  }

  const directoryName = options.developmentDirectoryName || DEVELOPMENT_DIRECTORY_NAME;
  const developmentPath = path.join(electronApp.getPath('appData'), directoryName);
  electronApp.setPath('userData', developmentPath);
  return developmentPath;
}

module.exports = {
  DEVELOPMENT_DIRECTORY_NAME,
  configureUserDataScope,
};
