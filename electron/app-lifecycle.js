const DEFAULT_SHUTDOWN_TIMEOUT_MS = 15_000;

function createAppLifecycleController({
  app,
  platform = process.platform,
  prepareForQuit = () => {},
  shutdownBackend = () => {},
  shutdownTimeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
  logger = console,
}) {
  let shutdownPromise = null;
  let quitPrepared = false;
  let quitResumed = false;

  function beginBackendShutdown() {
    if (shutdownPromise) {
      return shutdownPromise;
    }

    let shutdownResult;
    try {
      shutdownResult = shutdownBackend();
    } catch (error) {
      shutdownResult = Promise.reject(error);
    }

    const rawShutdownPromise = Promise.resolve(shutdownResult);
    if (Number.isFinite(shutdownTimeoutMs) && shutdownTimeoutMs > 0) {
      shutdownPromise = new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          logger.warn?.('Backend shutdown timed out; continuing application quit', {
            timeoutMs: shutdownTimeoutMs,
          });
          resolve();
        }, shutdownTimeoutMs);

        rawShutdownPromise.then(
          (value) => {
            clearTimeout(timeoutId);
            resolve(value);
          },
          (error) => {
            clearTimeout(timeoutId);
            reject(error);
          },
        );
      });
    } else {
      shutdownPromise = rawShutdownPromise;
    }
    shutdownPromise.catch((error) => {
      logger.error?.('Failed to shut down backend services', {
        error: error?.message || String(error),
      });
    });
    return shutdownPromise;
  }

  function handleWindowAllClosed() {
    // macOS keeps the application process alive after its final window closes.
    // Its process-lifetime backend must stay alive for the next Dock activation.
    if (platform !== 'darwin') {
      app.quit();
    }
  }

  function handleBeforeQuit(event) {
    if (quitResumed) {
      return;
    }

    // Electron does not await async before-quit listeners. Keep the process
    // alive until the embedded server and database connections are closed,
    // then issue one final quit that is allowed to continue normally.
    event?.preventDefault?.();

    if (!quitPrepared) {
      quitPrepared = true;
      try {
        prepareForQuit();
      } catch (error) {
        logger.error?.('Failed to prepare application quit', {
          error: error?.message || String(error),
        });
      }
    }

    void beginBackendShutdown().then(
      () => {
        if (!quitResumed) {
          quitResumed = true;
          app.quit();
        }
      },
      () => {
        // The failure is logged by beginBackendShutdown. Do not trap the app
        // in a permanently unquittable state if one cleanup task fails.
        if (!quitResumed) {
          quitResumed = true;
          app.quit();
        }
      },
    );
  }

  return {
    beginBackendShutdown,
    handleBeforeQuit,
    handleWindowAllClosed,
  };
}

module.exports = { DEFAULT_SHUTDOWN_TIMEOUT_MS, createAppLifecycleController };
