import { jsx as _jsx } from "react/jsx-runtime";
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AppProviders } from './providers/AppProviders';
ReactDOM.createRoot(document.getElementById('root')).render(_jsx(React.StrictMode, { children: _jsx(AppProviders, { children: _jsx(App, {}) }) }));
