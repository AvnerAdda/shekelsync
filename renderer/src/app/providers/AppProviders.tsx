import { ThemeContextProvider } from '@renderer/contexts/ThemeContext';
import { AuthProvider } from '@app/contexts/AuthContext';
import { FinancePrivacyProvider } from '@app/contexts/FinancePrivacyContext';
import { ChatbotPermissionsProvider } from '@app/contexts/ChatbotPermissionsContext';
import { NotificationProvider } from '@renderer/features/notifications/NotificationContext';
import { OnboardingProvider } from '@app/contexts/OnboardingContext';
import { SecurityProvider } from '@renderer/features/security/contexts/SecurityContext';
import AppLockGate from '@renderer/features/security/components/AppLockGate';
import { DonationStatusProvider } from '@renderer/features/support/contexts/DonationStatusContext';
import type { PropsWithChildren } from 'react';
import { I18nProvider, useLocaleSettings } from '@renderer/i18n/I18nProvider';
import HealthScoreThemeSync from '@renderer/features/analysis/components/HealthScoreThemeSync';

const ConnectedProviders: React.FC<PropsWithChildren> = ({ children }) => {
  const { direction, locale } = useLocaleSettings();

  return (
    <ThemeContextProvider direction={direction}>
      {/* Nothing below may load data until the app lock is cleared. */}
      <AppLockGate>
        <AuthProvider>
          <FinancePrivacyProvider locale={locale}>
            <ChatbotPermissionsProvider>
              <NotificationProvider>
                <SecurityProvider>
                  <DonationStatusProvider>
                    <OnboardingProvider>
                      {/* App accent follows the health score from launch. */}
                      <HealthScoreThemeSync />
                      {children}
                    </OnboardingProvider>
                  </DonationStatusProvider>
                </SecurityProvider>
              </NotificationProvider>
            </ChatbotPermissionsProvider>
          </FinancePrivacyProvider>
        </AuthProvider>
      </AppLockGate>
    </ThemeContextProvider>
  );
};

export const AppProviders: React.FC<PropsWithChildren> = ({ children }) => (
  <I18nProvider>
    <ConnectedProviders>{children}</ConnectedProviders>
  </I18nProvider>
);
