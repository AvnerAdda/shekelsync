import { ThemeContextProvider } from '@renderer/contexts/ThemeContext';
import { AuthProvider } from '@app/contexts/AuthContext';
import { FinancePrivacyProvider } from '@app/contexts/FinancePrivacyContext';
import { ChatbotPermissionsProvider } from '@app/contexts/ChatbotPermissionsContext';
import { NotificationProvider } from '@renderer/features/notifications/NotificationContext';
import { OnboardingProvider } from '@app/contexts/OnboardingContext';
import { TelemetryProvider } from '@app/contexts/TelemetryContext';
import type { PropsWithChildren } from 'react';
import { I18nProvider, useLocaleSettings } from '@renderer/i18n/I18nProvider';

const ConnectedProviders: React.FC<PropsWithChildren> = ({ children }) => {
  const { direction, locale } = useLocaleSettings();

  return (
    <ThemeContextProvider direction={direction}>
      <AuthProvider>
        <FinancePrivacyProvider locale={locale}>
          <ChatbotPermissionsProvider>
            <NotificationProvider>
              <TelemetryProvider>
                <OnboardingProvider>{children}</OnboardingProvider>
              </TelemetryProvider>
            </NotificationProvider>
          </ChatbotPermissionsProvider>
        </FinancePrivacyProvider>
      </AuthProvider>
    </ThemeContextProvider>
  );
};

export const AppProviders: React.FC<PropsWithChildren> = ({ children }) => (
  <I18nProvider>
    <ConnectedProviders>{children}</ConnectedProviders>
  </I18nProvider>
);
