const { contextBridge, ipcRenderer } = require('electron');

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
  }
});

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close')
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
