import { ThemeContextProvider } from '@app/contexts/ThemeContext';
import { AuthProvider } from '@app/contexts/AuthContext';
import { FinancePrivacyProvider } from '@app/contexts/FinancePrivacyContext';
import { ChatbotPermissionsProvider } from '@app/contexts/ChatbotPermissionsContext';
import { NotificationProvider } from '@app/components/NotificationContext';
import { OnboardingProvider } from '@app/contexts/OnboardingContext';
import type { PropsWithChildren } from 'react';

export const AppProviders: React.FC<PropsWithChildren> = ({ children }) => (
  <ThemeContextProvider>
    <AuthProvider>
      <FinancePrivacyProvider>
        <ChatbotPermissionsProvider>
          <NotificationProvider>
            <OnboardingProvider>{children}</OnboardingProvider>
          </NotificationProvider>
        </ChatbotPermissionsProvider>
      </FinancePrivacyProvider>
    </AuthProvider>
  </ThemeContextProvider>
);
