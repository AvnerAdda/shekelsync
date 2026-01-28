const path = require('path');
const fs = require('fs');

function resolveElectronPath(...segments) {
  // Debug: log detection info
  console.log('[resolveElectronPath] __dirname:', __dirname);
  console.log('[resolveElectronPath] process.resourcesPath:', process.resourcesPath);

  // Check if we're in a packaged Electron app
  // Method 1: Check resourcesPath (set by Electron in packaged apps)
  // Method 2: Check if __dirname contains .asar
  const hasResourcesPath = process.resourcesPath && !process.resourcesPath.includes('node_modules');
  const isInsideAsar = __dirname.includes('.asar');
  const isPackaged = hasResourcesPath || isInsideAsar;

  console.log('[resolveElectronPath] isPackaged:', isPackaged, '(hasResourcesPath:', hasResourcesPath, ', isInsideAsar:', isInsideAsar, ')');

  if (isPackaged && process.resourcesPath) {
    // In packaged app, electron folder is inside app.asar
    const resolvedPath = path.join(process.resourcesPath, 'app.asar', 'electron', ...segments);
    console.log('[resolveElectronPath] Resolved (packaged):', resolvedPath);
    return resolvedPath;
  }

  // Dev mode: try packaged path first (electron is sibling to app folder in build output)
  const packagedPath = path.join(__dirname, '..', '..', 'electron', ...segments);
  if (fs.existsSync(packagedPath) || fs.existsSync(packagedPath + '.js')) {
    console.log('[resolveElectronPath] Resolved (dev packaged):', packagedPath);
    return packagedPath;
  }

  // Dev path (electron is sibling to app folder in source)
  const devPath = path.join(__dirname, '..', '..', '..', 'electron', ...segments);
  console.log('[resolveElectronPath] Resolved (dev):', devPath);
  return devPath;
}

module.exports = { resolveElectronPath };
