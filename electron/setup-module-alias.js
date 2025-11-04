const path = require('path');
const Module = require('module');

if (!global.__electronAliasRegistered) {
  const appRoot = path.join(__dirname, '..', 'app');
  const originalResolveFilename = Module._resolveFilename;

  Module._resolveFilename = function patchedResolve(request, parent, isMain, options) {
    if (request.startsWith('@/')) {
      const resolved = path.join(appRoot, request.slice(2));
      return originalResolveFilename.call(this, resolved, parent, isMain, options);
    }

    if (request === 'electron' && process.versions && process.versions.electron) {
      return request;
    }

    if (request === '@') {
      const resolved = appRoot;
      return originalResolveFilename.call(this, resolved, parent, isMain, options);
    }

    return originalResolveFilename.call(this, request, parent, isMain, options);
  };

  // Ensure app/node_modules is available for resolution
  Module.globalPaths.unshift(path.join(appRoot, 'node_modules'));

  global.__electronAliasRegistered = true;
}

module.exports = {};
