function createMainWindowStartup({
  app,
  prepare,
  createWindow,
  getWindow,
  canCreateWindow = () => true,
}) {
  let preparationPromise = null;
  let creationPromise = null;

  return function ensureMainWindow() {
    if (!canCreateWindow()) return Promise.resolve(null);
    if (creationPromise) return creationPromise;

    // Dock activation, second-instance events and normal startup can all ask
    // for the window while Electron or the backend is still initializing.
    creationPromise = (async () => {
      await app.whenReady();
      if (!canCreateWindow()) return null;

      if (!preparationPromise) {
        preparationPromise = Promise.resolve().then(prepare).catch((error) => {
          preparationPromise = null;
          throw error;
        });
      }
      await preparationPromise;
      if (!canCreateWindow()) return null;

      const existingWindow = getWindow();
      if (existingWindow && !existingWindow.isDestroyed()) return existingWindow;

      await createWindow();
      return getWindow();
    })().finally(() => {
      creationPromise = null;
    });

    return creationPromise;
  };
}

module.exports = { createMainWindowStartup };
