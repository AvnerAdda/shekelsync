import React, { createContext, useContext, useEffect, useState } from 'react';

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
  const [chatbotEnabled, setChatbotEnabledState] = useState<boolean>(true);
  const [allowTransactionAccess, setAllowTransactionAccessState] = useState<boolean>(false);
  const [allowCategoryAccess, setAllowCategoryAccessState] = useState<boolean>(false);
  const [allowAnalyticsAccess, setAllowAnalyticsAccessState] = useState<boolean>(false);

  useEffect(() => {
    // Load saved permissions from localStorage
    const savedEnabled = localStorage.getItem('chatbot-enabled');
    if (savedEnabled !== null) {
      setChatbotEnabledState(savedEnabled === 'true');
    }

    const savedTransactionAccess = localStorage.getItem('chatbot-transaction-access');
    if (savedTransactionAccess !== null) {
      setAllowTransactionAccessState(savedTransactionAccess === 'true');
    }

    const savedCategoryAccess = localStorage.getItem('chatbot-category-access');
    if (savedCategoryAccess !== null) {
      setAllowCategoryAccessState(savedCategoryAccess === 'true');
    }

    const savedAnalyticsAccess = localStorage.getItem('chatbot-analytics-access');
    if (savedAnalyticsAccess !== null) {
      setAllowAnalyticsAccessState(savedAnalyticsAccess === 'true');
    }
  }, []);

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
