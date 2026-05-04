import React, { createContext, useContext, useEffect, useRef, useState } from 'react';

export type ModelTier = 'light' | 'normal' | 'heavy';

export const MODEL_TIERS: Record<ModelTier, { model: string; label: string }> = {
  light: { model: 'gpt-4o-mini', label: 'Light' },
  normal: { model: 'gpt-4o', label: 'Normal' },
  heavy: { model: 'gpt-4.1', label: 'Heavy' },
};

const VALID_TIERS = new Set<string>(Object.keys(MODEL_TIERS));
const OPENAI_API_KEY_STORAGE_KEY = 'chatbot-openai-api-key';
const OPENAI_API_KEY_BOOTSTRAP_KEY = '__SHEKELSYNC_OPENAI_API_KEY__';

type OpenAiKeyWindow = Window &
  typeof globalThis & {
    [OPENAI_API_KEY_BOOTSTRAP_KEY]?: string;
  };

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
  hasOpenAiApiKey: boolean;
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

const getOpenAiKeyWindow = (): OpenAiKeyWindow | null => {
  if (typeof window === 'undefined') {
    return null;
  }
  return window as OpenAiKeyWindow;
};

const readBootstrappedApiKey = (): string => {
  const keyWindow = getOpenAiKeyWindow();
  const rawValue = typeof keyWindow?.[OPENAI_API_KEY_BOOTSTRAP_KEY] === 'string'
    ? keyWindow[OPENAI_API_KEY_BOOTSTRAP_KEY]
    : '';
  return rawValue.trim();
};

const consumeLegacyApiKey = (): string => {
  if (typeof window === 'undefined') {
    return '';
  }
  try {
    const stored = window.localStorage.getItem(OPENAI_API_KEY_STORAGE_KEY) || '';
    window.localStorage.removeItem(OPENAI_API_KEY_STORAGE_KEY);
    return stored.trim();
  } catch (error) {
    console.warn('[ChatbotPermissionsContext] Failed to migrate OpenAI API key from localStorage', error);
    return '';
  }
};

const resolveInitialOpenAiApiKey = (): string => readBootstrappedApiKey() || consumeLegacyApiKey();

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
  const initialOpenAiApiKeyRef = useRef<string | null>(null);
  if (initialOpenAiApiKeyRef.current === null) {
    initialOpenAiApiKeyRef.current = resolveInitialOpenAiApiKey();
  }
  const initialOpenAiApiKey = initialOpenAiApiKeyRef.current || '';
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
  const [openAiApiKey, setOpenAiApiKeyState] = useState<string>(() => initialOpenAiApiKey);
  const [hasOpenAiApiKey, setHasOpenAiApiKeyState] = useState<boolean>(() => initialOpenAiApiKey.length > 0);
  const [allowLongAnswers, setAllowLongAnswersState] = useState<boolean>(() =>
    readStoredBoolean('chatbot-long-answers', false)
  );
  const [allowLongRequests, setAllowLongRequestsState] = useState<boolean>(() =>
    readStoredBoolean('chatbot-long-requests', false)
  );
  const [chatModelTier, setChatModelTierState] = useState<ModelTier>(() =>
    readStoredTier('chatbot-model-tier', 'light')
  );

  useEffect(() => {
    const keyWindow = getOpenAiKeyWindow();
    if (keyWindow) {
      keyWindow[OPENAI_API_KEY_BOOTSTRAP_KEY] = openAiApiKey;
    }
  }, [openAiApiKey]);

  useEffect(() => {
    const bridge = window.electronAPI?.chatbotSecrets;
    if (!bridge?.getStatus) {
      return;
    }
    const getStatus = bridge.getStatus;
    const persistSecureApiKey = bridge.setOpenAiApiKey;

    let cancelled = false;

    const syncStoredApiKey = async () => {
      const pendingOpenAiApiKey = initialOpenAiApiKey.trim();
      if (pendingOpenAiApiKey) {
        try {
          const result = persistSecureApiKey
            ? await persistSecureApiKey(pendingOpenAiApiKey)
            : { success: false, error: 'Electron chatbot secret bridge unavailable' };
          if (!result.success) {
            throw new Error(result.error || 'Failed to persist OpenAI API key');
          }
          if (!cancelled) {
            setHasOpenAiApiKeyState(Boolean(result.hasOpenAiApiKey));
            setOpenAiApiKeyState('');
          }
        } catch (error) {
          console.warn('[ChatbotPermissionsContext] Failed to migrate OpenAI API key to secure storage', error);
        }
        return;
      }

      try {
        const result = await getStatus();
        if (!cancelled && result.success) {
          setHasOpenAiApiKeyState(Boolean(result.hasOpenAiApiKey));
        }
      } catch (error) {
        console.warn('[ChatbotPermissionsContext] Failed to load OpenAI API key status', error);
      }
    };

    void syncStoredApiKey();

    return () => {
      cancelled = true;
    };
  }, [initialOpenAiApiKey]);

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
    const normalizedApiKey = apiKey.trim();
    const bridge = window.electronAPI?.chatbotSecrets;
    setOpenAiApiKeyState(apiKey);
    setHasOpenAiApiKeyState(normalizedApiKey.length > 0);

    if (!bridge?.setOpenAiApiKey) {
      return;
    }

    bridge
      .setOpenAiApiKey(apiKey)
      .then((result) => {
        if (!result.success) {
          throw new Error(result.error || 'Failed to persist OpenAI API key');
        }
        setHasOpenAiApiKeyState(Boolean(result.hasOpenAiApiKey));
      })
      .catch((error) => {
        console.warn('[ChatbotPermissionsContext] Failed to persist OpenAI API key securely', error);
      });
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
        hasOpenAiApiKey,
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
