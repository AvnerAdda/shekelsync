import React, { createContext, useContext, useState } from 'react';

interface ChatbotPermissionsContextType {
  chatbotEnabled: boolean;
  setChatbotEnabled: (enabled: boolean) => void;
  allowTransactionAccess: boolean;
  setAllowTransactionAccess: (allow: boolean) => void;
  allowCategoryAccess: boolean;
  setAllowCategoryAccess: (allow: boolean) => void;
  allowAnalyticsAccess: boolean;
  setAllowAnalyticsAccess: (allow: boolean) => void;
}

const ChatbotPermissionsContext = createContext<ChatbotPermissionsContextType | undefined>(
  undefined
);

const readStoredBoolean = (key: string, fallback: boolean): boolean => {
  if (typeof window === 'undefined') {
    return fallback;
  }
  const stored = window.localStorage.getItem(key);
  return stored === null ? fallback : stored === 'true';
};

export const useChatbotPermissions = () => {
  const context = useContext(ChatbotPermissionsContext);
  if (!context) {
    throw new Error('useChatbotPermissions must be used within ChatbotPermissionsProvider');
  }
  return context;
};

export const ChatbotPermissionsProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [chatbotEnabled, setChatbotEnabledState] = useState<boolean>(() =>
    readStoredBoolean('chatbot-enabled', true)
  );
  const [allowTransactionAccess, setAllowTransactionAccessState] = useState<boolean>(() =>
    readStoredBoolean('chatbot-transaction-access', false)
  );
  const [allowCategoryAccess, setAllowCategoryAccessState] = useState<boolean>(() =>
    readStoredBoolean('chatbot-category-access', false)
  );
  const [allowAnalyticsAccess, setAllowAnalyticsAccessState] = useState<boolean>(() =>
    readStoredBoolean('chatbot-analytics-access', false)
  );

  const setChatbotEnabled = (enabled: boolean) => {
    setChatbotEnabledState(enabled);
    localStorage.setItem('chatbot-enabled', enabled.toString());
  };

  const setAllowTransactionAccess = (allow: boolean) => {
    setAllowTransactionAccessState(allow);
    localStorage.setItem('chatbot-transaction-access', allow.toString());
  };

  const setAllowCategoryAccess = (allow: boolean) => {
    setAllowCategoryAccessState(allow);
    localStorage.setItem('chatbot-category-access', allow.toString());
  };

  const setAllowAnalyticsAccess = (allow: boolean) => {
    setAllowAnalyticsAccessState(allow);
    localStorage.setItem('chatbot-analytics-access', allow.toString());
  };

  return (
    <ChatbotPermissionsContext.Provider
      value={{
        chatbotEnabled,
        setChatbotEnabled,
        allowTransactionAccess,
        setAllowTransactionAccess,
        allowCategoryAccess,
        setAllowCategoryAccess,
        allowAnalyticsAccess,
        setAllowAnalyticsAccess,
      }}
    >
      {children}
    </ChatbotPermissionsContext.Provider>
  );
};
