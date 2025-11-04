import { ThemeContextProvider } from '@app/contexts/ThemeContext';
import { AuthProvider } from '@app/contexts/AuthContext';
import { FinancePrivacyProvider } from '@app/contexts/FinancePrivacyContext';
import { NotificationProvider } from '@app/components/NotificationContext';
import { OnboardingProvider } from '@app/contexts/OnboardingContext';
import type { PropsWithChildren } from 'react';

export const AppProviders: React.FC<PropsWithChildren> = ({ children }) => (
  <ThemeContextProvider>
    <AuthProvider>
      <FinancePrivacyProvider>
        <NotificationProvider>
          <OnboardingProvider>{children}</OnboardingProvider>
        </NotificationProvider>
      </FinancePrivacyProvider>
    </AuthProvider>
  </ThemeContextProvider>
);
