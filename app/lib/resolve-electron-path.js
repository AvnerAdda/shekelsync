const path = require('path');
const fs = require('fs');

function resolveElectronPath(...segments) {
  // Try packaged path first (electron is sibling to server in asar)
  const packagedPath = path.join(__dirname, '..', '..', 'electron', ...segments);
  if (fs.existsSync(packagedPath) || fs.existsSync(packagedPath + '.js')) {
    return packagedPath;
  }
  // Dev path (electron is sibling to app folder)
  return path.join(__dirname, '..', '..', '..', 'electron', ...segments);
}

module.exports = { resolveElectronPath };
