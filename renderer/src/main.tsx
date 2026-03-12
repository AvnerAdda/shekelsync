import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AppProviders } from './app/providers/AppProviders';
import { installElectronLoggerBridge } from '@app/lib/install-electron-logger';

installElectronLoggerBridge();

if (typeof document !== 'undefined') {
  const platform = window.electronAPI?.platform;
  if (platform?.isMacOS) {
    document.documentElement.classList.add('platform-macos');
  }
  if (platform?.isWindows) {
    document.documentElement.classList.add('platform-windows');
  }
  if (platform?.isLinux) {
    document.documentElement.classList.add('platform-linux');
  }
  if (platform?.reduceVisualEffects) {
    document.documentElement.classList.add('reduce-visual-effects');
  }
}

const AppReadySignal: React.FC = () => {
  React.useEffect(() => {
    document.body.dataset.appReady = 'true';

    const startupShell = document.getElementById('startup-shell');
    if (!startupShell) {
      return;
    }

    const removeStartupShell = () => {
      startupShell.remove();
    };

    startupShell.addEventListener('transitionend', removeStartupShell, { once: true });
    const removalTimer = window.setTimeout(removeStartupShell, 220);

    return () => {
      window.clearTimeout(removalTimer);
      startupShell.removeEventListener('transitionend', removeStartupShell);
    };
  }, []);

  return null;
};

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <AppReadySignal />
    <AppProviders>
      <App />
    </AppProviders>
  </React.StrictMode>,
);
