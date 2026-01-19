const { contextBridge, ipcRenderer } = require('electron');

const createRequire = module?.constructor?.createRequire;
const requireFromApp = createRequire ? createRequire(`${__dirname}/../app/package.json`) : null;

try {
  if (requireFromApp) {
    requireFromApp('@sentry/electron/preload');
  }
} catch (error) {
  console.warn('[Preload] Failed to initialize Sentry preload bridge:', error.message);
}

const sendLog = (level, message, data) => {
  try {
    ipcRenderer.send('log:report', {
      level,
      message: typeof message === 'string' ? message : JSON.stringify(message),
      data,
    });
  } catch (error) {
    console.warn('Failed to send log message:', error);
  }
};

const logBridge = Object.freeze({
  info: (message, data) => sendLog('info', message, data),
  warn: (message, data) => sendLog('warn', message, data),
  error: (message, data) => sendLog('error', message, data),
  debug: (message, data) => sendLog('debug', message, data),
});

const diagnosticsBridge = Object.freeze({
  getInfo: () => ipcRenderer.invoke('diagnostics:getInfo'),
  openLogDirectory: () => ipcRenderer.invoke('diagnostics:openLogDirectory'),
  exportDiagnostics: (filePath) => {
    if (!filePath) {
      throw new Error('Diagnostics export requires a destination path');
    }
    return ipcRenderer.invoke('diagnostics:export', filePath);
  },
});

const telemetryBridge = Object.freeze({
  getConfig: () => ipcRenderer.invoke('telemetry:getConfig'),
  triggerMainSmoke: () => ipcRenderer.invoke('telemetry:triggerMainSmoke'),
  triggerRendererSmoke: () => {
    setTimeout(() => {
      throw new Error('Telemetry smoke test (renderer process)');
    }, 0);
    return Promise.resolve({ success: true });
  },
});

const authBridge = Object.freeze({
  getSession: () => ipcRenderer.invoke('auth:getSession'),
  setSession: (session) => {
    if (session && typeof session !== 'object') {
      throw new Error('Session payload must be an object or null');
    }
    return ipcRenderer.invoke('auth:setSession', session);
  },
  clearSession: () => ipcRenderer.invoke('auth:clearSession')
});

const eventsBridge = Object.freeze({
  onScrapeProgress: (callback) => {
    const wrappedCallback = (event, ...args) => callback(...args);
    ipcRenderer.on('scrape:progress', wrappedCallback);

    return () => ipcRenderer.removeListener('scrape:progress', wrappedCallback);
  },
  onScrapeComplete: (callback) => {
    const wrappedCallback = (event, ...args) => callback(...args);
    ipcRenderer.on('scrape:complete', wrappedCallback);

    return () => ipcRenderer.removeListener('scrape:complete', wrappedCallback);
  },
  onScrapeError: (callback) => {
    const wrappedCallback = (event, ...args) => callback(...args);
    ipcRenderer.on('scrape:error', wrappedCallback);

    return () => ipcRenderer.removeListener('scrape:error', wrappedCallback);
  },
  onDataRefresh: (callback) => {
    const wrappedCallback = (event, ...args) => callback(...args);
    ipcRenderer.on('data:refresh', wrappedCallback);

    return () => ipcRenderer.removeListener('data:refresh', wrappedCallback);
  },
  onNotification: (callback) => {
    const wrappedCallback = (event, ...args) => callback(...args);
    ipcRenderer.on('notification:show', wrappedCallback);

    return () => ipcRenderer.removeListener('notification:show', wrappedCallback);
  },
  onAuthSessionChanged: (callback) => {
    const wrappedCallback = (event, ...args) => callback(...args);
    ipcRenderer.on('auth:session-changed', wrappedCallback);

    return () => ipcRenderer.removeListener('auth:session-changed', wrappedCallback);
  },
  onWindowStateChanged: (callback) => {
    const wrappedCallback = (event, ...args) => callback(...args);
    ipcRenderer.on('window:state-changed', wrappedCallback);

    return () => ipcRenderer.removeListener('window:state-changed', wrappedCallback);
  },
  onUpdateCheckingForUpdate: (callback) => {
    const wrappedCallback = (event, ...args) => callback(...args);
    ipcRenderer.on('updater:checking-for-update', wrappedCallback);

    return () => ipcRenderer.removeListener('updater:checking-for-update', wrappedCallback);
  },
  onUpdateAvailable: (callback) => {
    const wrappedCallback = (event, ...args) => callback(...args);
    ipcRenderer.on('updater:update-available', wrappedCallback);

    return () => ipcRenderer.removeListener('updater:update-available', wrappedCallback);
  },
  onUpdateNotAvailable: (callback) => {
    const wrappedCallback = (event, ...args) => callback(...args);
    ipcRenderer.on('updater:update-not-available', wrappedCallback);

    return () => ipcRenderer.removeListener('updater:update-not-available', wrappedCallback);
  },
  onUpdateError: (callback) => {
    const wrappedCallback = (event, ...args) => callback(...args);
    ipcRenderer.on('updater:error', wrappedCallback);

    return () => ipcRenderer.removeListener('updater:error', wrappedCallback);
  },
  onUpdateDownloadProgress: (callback) => {
    const wrappedCallback = (event, ...args) => callback(...args);
    ipcRenderer.on('updater:download-progress', wrappedCallback);

    return () => ipcRenderer.removeListener('updater:download-progress', wrappedCallback);
  },
  onUpdateDownloaded: (callback) => {
    const wrappedCallback = (event, ...args) => callback(...args);
    ipcRenderer.on('updater:update-downloaded', wrappedCallback);

    return () => ipcRenderer.removeListener('updater:update-downloaded', wrappedCallback);
  },
});

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    zoomIn: () => ipcRenderer.invoke('window:zoomIn'),
    zoomOut: () => ipcRenderer.invoke('window:zoomOut'),
    zoomReset: () => ipcRenderer.invoke('window:zoomReset'),
    getZoomLevel: () => ipcRenderer.invoke('window:getZoomLevel')
  },

  // Database operations
  db: {
    query: (sql, params) => ipcRenderer.invoke('db:query', sql, params),
    test: () => ipcRenderer.invoke('db:test'),
    stats: () => ipcRenderer.invoke('db:stats')
  },

  // Core API operations (native IPC)
  api: {
    // Core endpoints using direct IPC (faster)
    ping: () => ipcRenderer.invoke('api:ping'),
    credentials: () => ipcRenderer.invoke('api:credentials'),
    categories: () => ipcRenderer.invoke('api:categories'),

    // Generic API proxy (for other endpoints)
    request: (method, endpoint, data, headers) =>
      ipcRenderer.invoke('api:request', { method, endpoint, data, headers }),

    // Convenience methods
    get: (endpoint, headers) =>
      ipcRenderer.invoke('api:request', { method: 'GET', endpoint, headers }),

    post: (endpoint, data, headers) =>
      ipcRenderer.invoke('api:request', { method: 'POST', endpoint, data, headers }),

    put: (endpoint, data, headers) =>
      ipcRenderer.invoke('api:request', { method: 'PUT', endpoint, data, headers }),

    delete: (endpoint, headers) =>
      ipcRenderer.invoke('api:request', { method: 'DELETE', endpoint, headers }),

    patch: (endpoint, data, headers) =>
      ipcRenderer.invoke('api:request', { method: 'PATCH', endpoint, data, headers })
  },

  // Scraping operations
  scraper: {
    start: (options, credentials) => ipcRenderer.invoke('scrape:start', options, credentials),
    events: (limit) => ipcRenderer.invoke('scrape:events', limit),
    test: (companyId) => ipcRenderer.invoke('scrape:test', companyId),

    // Listen for progress updates
    onProgress: (callback) => {
      const handleProgress = (event, data) => callback(data);
      ipcRenderer.on('scrape:progress', handleProgress);

      // Return cleanup function
      return () => ipcRenderer.removeListener('scrape:progress', handleProgress);
    }
  },

  // File system operations
  file: {
    showSaveDialog: (options) => ipcRenderer.invoke('file:showSaveDialog', options),
    showOpenDialog: (options) => ipcRenderer.invoke('file:showOpenDialog', options),
    writeFile: (filePath, data, options) => ipcRenderer.invoke('file:write', filePath, data, options)
  },

  // Auth/session persistence
  auth: authBridge,
  log: logBridge,
  diagnostics: diagnosticsBridge,
  telemetry: telemetryBridge,

  // App information
  app: {
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
    getName: () => ipcRenderer.invoke('app:getName'),
    isPackaged: () => ipcRenderer.invoke('app:isPackaged')
  },

  // Event listeners for real-time updates
  events: eventsBridge,

  // Platform detection
  platform: {
    isWindows: process.platform === 'win32',
    isMacOS: process.platform === 'darwin',
    isLinux: process.platform === 'linux'
  },

  // Update operations
  updater: {
    checkForUpdates: () => ipcRenderer.invoke('updater:checkForUpdates'),
    downloadUpdate: () => ipcRenderer.invoke('updater:downloadUpdate'),
    quitAndInstall: () => ipcRenderer.invoke('updater:quitAndInstall'),
    getUpdateInfo: () => ipcRenderer.invoke('updater:getUpdateInfo'),
  },

  // Development utilities (only available in development)
  dev: process.env.NODE_ENV === 'development' ? {
    reload: () => ipcRenderer.invoke('dev:reload'),
    toggleDevTools: () => ipcRenderer.invoke('dev:toggleDevTools'),
    log: (...args) => console.log('[Renderer]', ...args)
  } : undefined
});

// Security: Remove any globals that could be used to break out of the sandbox
delete global.Buffer;
delete global.process;
delete global.setImmediate;
delete global.clearImmediate;

// Prevent the renderer from accessing Node.js APIs
Object.freeze(contextBridge);

// Log successful preload
console.log('Electron preload script loaded successfully');

// Expose environment info for debugging
if (process.env.NODE_ENV === 'development') {
  console.log('Development mode enabled');
  console.log('Platform:', process.platform);
  console.log('Electron version:', process.versions.electron);
  console.log('Node version:', process.versions.node);
  console.log('Chrome version:', process.versions.chrome);
}
