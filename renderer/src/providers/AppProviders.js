import { jsx as _jsx } from "react/jsx-runtime";
import { ThemeContextProvider } from '@app/contexts/ThemeContext';
import { AuthProvider } from '@app/contexts/AuthContext';
import { FinancePrivacyProvider } from '@app/contexts/FinancePrivacyContext';
import { NotificationProvider } from '@app/components/NotificationContext';
import { OnboardingProvider } from '@app/contexts/OnboardingContext';
export const AppProviders = ({ children }) => (_jsx(ThemeContextProvider, { children: _jsx(AuthProvider, { children: _jsx(FinancePrivacyProvider, { children: _jsx(NotificationProvider, { children: _jsx(OnboardingProvider, { children: children }) }) }) }) }));
