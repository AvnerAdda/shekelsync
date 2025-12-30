// Force all Node date operations to use Jerusalem time to avoid UTC drift in timestamps
if (!process.env.TZ) {
  process.env.TZ = 'Asia/Jerusalem';
}

const path = require('path');
const Module = require('module');
const { appRoot } = require('./paths');

if (!global.__electronAliasRegistered) {
  const originalResolveFilename = Module._resolveFilename;

  Module._resolveFilename = function patchedResolve(request, parent, isMain, options) {
    if (request.startsWith('@/')) {
      const resolved = path.join(appRoot, request.slice(2));
      return originalResolveFilename.call(this, resolved, parent, isMain, options);
    }

    if (request === 'electron') {
      // In Electron runtime, defer to the built-in module
      if (process.versions && process.versions.electron) {
        return request;
      }
      // In plain Node (e.g., running the dev API server), use a lightweight stub
      const stubPath = path.join(__dirname, 'electron-stub.js');
      return originalResolveFilename.call(this, stubPath, parent, isMain, options);
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
