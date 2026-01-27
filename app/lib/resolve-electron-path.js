const path = require('path');
const fs = require('fs');

function resolveElectronPath(...segments) {
  // Packaged path (electron is sibling to app folder inside asar)
  const packagedPath = path.join(__dirname, '..', '..', 'electron', ...segments);

  // In packaged app, fs.existsSync doesn't work reliably with asar paths,
  // so check if we're inside an asar archive
  const isPackaged = __dirname.includes('app.asar');

  if (isPackaged) {
    // In packaged app, always use the packaged path
    return packagedPath;
  }

  // In dev mode, check if packaged path exists, otherwise use dev path
  if (fs.existsSync(packagedPath) || fs.existsSync(packagedPath + '.js')) {
    return packagedPath;
  }

  // Dev path (electron is sibling to app folder)
  return path.join(__dirname, '..', '..', '..', 'electron', ...segments);
}

module.exports = { resolveElectronPath };
