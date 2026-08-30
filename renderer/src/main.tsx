import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AppProviders } from './app/providers/AppProviders';
import { STARTUP_READY_EVENT } from './app/startup/startup-readiness';
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

const StartupShellController: React.FC = () => {
  React.useEffect(() => {
    if (document.body.dataset.appReady === 'true') return undefined;

    const updateSlowStartupMessage = () => {
      const status = document.querySelector<HTMLElement>('[data-startup-status]');
      const caption = document.querySelector<HTMLElement>('[data-startup-caption]');
      if (status) status.textContent = 'The local service is still preparing your financial workspace.';
      if (caption) caption.textContent = 'Finishing startup…';
    };
    const slowStartupTimer = window.setTimeout(updateSlowStartupMessage, 6_000);
    const clearSlowStartupTimer = () => window.clearTimeout(slowStartupTimer);

    window.addEventListener(STARTUP_READY_EVENT, clearSlowStartupTimer, { once: true });

    return () => {
      clearSlowStartupTimer();
      window.removeEventListener(STARTUP_READY_EVENT, clearSlowStartupTimer);
    };
  }, []);

  return null;
};

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <StartupShellController />
    <AppProviders>
      <App />
    </AppProviders>
  </React.StrictMode>,
);
