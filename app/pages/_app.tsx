import React from 'react';
import type { AppProps } from 'next/app';
import { ThemeContextProvider } from '../contexts/ThemeContext';
import { FinancePrivacyProvider } from '../contexts/FinancePrivacyContext';
import { NotificationProvider } from '../components/NotificationContext';
import { OnboardingProvider } from '../contexts/OnboardingContext';
import '@fontsource/roboto/300.css';
import '@fontsource/roboto/400.css';
import '@fontsource/roboto/500.css';
import '@fontsource/roboto/700.css';
import '../styles/globals.css';

export default function App({ Component, pageProps }: AppProps) {
  return (
    <ThemeContextProvider>
      <FinancePrivacyProvider>
        <NotificationProvider>
          <OnboardingProvider>
            <Component {...pageProps} />
          </OnboardingProvider>
        </NotificationProvider>
      </FinancePrivacyProvider>
    </ThemeContextProvider>
  );
}
