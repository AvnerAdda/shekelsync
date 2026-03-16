import React, { createContext, useContext, useState } from 'react';

export type ModelTier = 'light' | 'normal' | 'heavy';

export const MODEL_TIERS: Record<ModelTier, { model: string; label: string }> = {
  light: { model: 'gpt-4o-mini', label: 'Light' },
  normal: { model: 'gpt-4o', label: 'Normal' },
  heavy: { model: 'gpt-4.1', label: 'Heavy' },
};

const VALID_TIERS = new Set<string>(Object.keys(MODEL_TIERS));

function readStoredTier(key: string, fallback: ModelTier): ModelTier {
  if (typeof window === 'undefined') return fallback;
  try {
    const stored = window.localStorage.getItem(key);
    return stored && VALID_TIERS.has(stored) ? (stored as ModelTier) : fallback;
  } catch {
    return fallback;
  }
}

interface ChatbotPermissionsContextType {
  chatbotEnabled: boolean;
  setChatbotEnabled: (enabled: boolean) => void;
  allowTransactionAccess: boolean;
  setAllowTransactionAccess: (allow: boolean) => void;
  allowCategoryAccess: boolean;
  setAllowCategoryAccess: (allow: boolean) => void;
  allowAnalyticsAccess: boolean;
  setAllowAnalyticsAccess: (allow: boolean) => void;
  openAiApiKey: string;
  setOpenAiApiKey: (apiKey: string) => void;
  allowLongAnswers: boolean;
  setAllowLongAnswers: (allow: boolean) => void;
  allowLongRequests: boolean;
  setAllowLongRequests: (allow: boolean) => void;
  chatModelTier: ModelTier;
  setChatModelTier: (tier: ModelTier) => void;
}

const ChatbotPermissionsContext = createContext<ChatbotPermissionsContextType | undefined>(
  undefined
);

const readStoredBoolean = (key: string, fallback: boolean): boolean => {
  if (typeof window === 'undefined') {
    return fallback;
  }

  try {
    const stored = window.localStorage.getItem(key);
    return stored === null ? fallback : stored === 'true';
  } catch (error) {
    console.warn(`[ChatbotPermissionsContext] Failed to read "${key}" from localStorage`, error);
    return fallback;
  }
};

const readStoredString = (key: string, fallback = ''): string => {
  if (typeof window === 'undefined') {
    return fallback;
  }

  try {
    const stored = window.localStorage.getItem(key);
    return stored === null ? fallback : stored;
  } catch (error) {
    console.warn(`[ChatbotPermissionsContext] Failed to read "${key}" from localStorage`, error);
    return fallback;
  }
};

const persistBoolean = (key: string, value: boolean): void => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(key, value.toString());
  } catch (error) {
    console.warn(`[ChatbotPermissionsContext] Failed to persist "${key}"`, error);
  }
};

const persistString = (key: string, value: string): void => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(key, value);
  } catch (error) {
    console.warn(`[ChatbotPermissionsContext] Failed to persist "${key}"`, error);
  }
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
  const [openAiApiKey, setOpenAiApiKeyState] = useState<string>(() =>
    readStoredString('chatbot-openai-api-key', '')
  );
  const [allowLongAnswers, setAllowLongAnswersState] = useState<boolean>(() =>
    readStoredBoolean('chatbot-long-answers', false)
  );
  const [allowLongRequests, setAllowLongRequestsState] = useState<boolean>(() =>
    readStoredBoolean('chatbot-long-requests', false)
  );
  const [chatModelTier, setChatModelTierState] = useState<ModelTier>(() =>
    readStoredTier('chatbot-model-tier', 'light')
  );

  const setChatbotEnabled = (enabled: boolean) => {
    setChatbotEnabledState(enabled);
    persistBoolean('chatbot-enabled', enabled);
  };

  const setAllowTransactionAccess = (allow: boolean) => {
    setAllowTransactionAccessState(allow);
    persistBoolean('chatbot-transaction-access', allow);
  };

  const setAllowCategoryAccess = (allow: boolean) => {
    setAllowCategoryAccessState(allow);
    persistBoolean('chatbot-category-access', allow);
  };

  const setAllowAnalyticsAccess = (allow: boolean) => {
    setAllowAnalyticsAccessState(allow);
    persistBoolean('chatbot-analytics-access', allow);
  };

  const setOpenAiApiKey = (apiKey: string) => {
    setOpenAiApiKeyState(apiKey);
    persistString('chatbot-openai-api-key', apiKey);
  };

  const setAllowLongAnswers = (allow: boolean) => {
    setAllowLongAnswersState(allow);
    persistBoolean('chatbot-long-answers', allow);
  };

  const setAllowLongRequests = (allow: boolean) => {
    setAllowLongRequestsState(allow);
    persistBoolean('chatbot-long-requests', allow);
  };

  const setChatModelTier = (tier: ModelTier) => {
    setChatModelTierState(tier);
    persistString('chatbot-model-tier', tier);
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
        openAiApiKey,
        setOpenAiApiKey,
        allowLongAnswers,
        setAllowLongAnswers,
        allowLongRequests,
        setAllowLongRequests,
        chatModelTier,
        setChatModelTier,
      }}
    >
      {children}
    </ChatbotPermissionsContext.Provider>
  );
};
