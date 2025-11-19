import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AppProviders } from './app/providers/AppProviders';
import { installElectronLoggerBridge } from '@app/lib/install-electron-logger';

installElectronLoggerBridge();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <AppProviders>
      <App />
    </AppProviders>
  </React.StrictMode>,
);
