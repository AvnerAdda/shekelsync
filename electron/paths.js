const fs = require('fs');
const path = require('path');

function resolveAppRoot() {
  const packagedCandidate = path.join(__dirname, '..');
  if (fs.existsSync(path.join(packagedCandidate, 'server'))) {
    return packagedCandidate;
  }
  return path.join(__dirname, '..', 'app');
}

const appRoot = resolveAppRoot();

const rendererRoot = (() => {
  const siblingRenderer = path.join(appRoot, '..', 'renderer');
  if (fs.existsSync(path.join(siblingRenderer, 'dist'))) {
    return siblingRenderer;
  }
  return path.join(appRoot, 'renderer');
})();

const nodeModulesPath = (() => {
  const direct = path.join(appRoot, 'node_modules');
  if (fs.existsSync(direct)) {
    return direct;
  }
  return path.join(appRoot, '..', 'node_modules');
})();

function resolveAppPath(...segments) {
  return path.join(appRoot, ...segments);
}

function resolveRendererPath(...segments) {
  return path.join(rendererRoot, ...segments);
}

function requireFromApp(modulePath) {
  const resolved = path.join(nodeModulesPath, modulePath);
  return require(resolved);
}

module.exports = {
  appRoot,
  rendererRoot,
  nodeModulesPath,
  resolveAppPath,
  resolveRendererPath,
  requireFromApp,
};
