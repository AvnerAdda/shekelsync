import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { ChatbotPermissionsProvider, useChatbotPermissions } from '../ChatbotPermissionsContext';

const OPENAI_API_KEY_STORAGE_KEY = 'chatbot-openai-api-key';
const OPENAI_API_KEY_BOOTSTRAP_KEY = '__SHEKELSYNC_OPENAI_API_KEY__';

const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ChatbotPermissionsProvider>{children}</ChatbotPermissionsProvider>
);

describe('ChatbotPermissionsContext', () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete (window as any).electronAPI;
    delete (window as any)[OPENAI_API_KEY_BOOTSTRAP_KEY];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses safe defaults when nothing is stored', () => {
    const { result } = renderHook(() => useChatbotPermissions(), { wrapper });

    expect(result.current.chatbotEnabled).toBe(true);
    expect(result.current.allowTransactionAccess).toBe(false);
    expect(result.current.allowCategoryAccess).toBe(false);
    expect(result.current.allowAnalyticsAccess).toBe(false);
    expect(result.current.hasOpenAiApiKey).toBe(false);
    expect(result.current.openAiApiKey).toBe('');
  });

  it('initializes flags from localStorage and migrates legacy API keys into memory', () => {
    window.localStorage.setItem('chatbot-enabled', 'false');
    window.localStorage.setItem('chatbot-transaction-access', 'true');
    window.localStorage.setItem('chatbot-category-access', 'true');
    window.localStorage.setItem('chatbot-analytics-access', 'false');
    window.localStorage.setItem(OPENAI_API_KEY_STORAGE_KEY, 'sk-test');

    const { result } = renderHook(() => useChatbotPermissions(), { wrapper });

    expect(result.current.chatbotEnabled).toBe(false);
    expect(result.current.allowTransactionAccess).toBe(true);
    expect(result.current.allowCategoryAccess).toBe(true);
    expect(result.current.allowAnalyticsAccess).toBe(false);
    expect(result.current.hasOpenAiApiKey).toBe(true);
    expect(result.current.openAiApiKey).toBe('sk-test');
    expect(window.localStorage.getItem(OPENAI_API_KEY_STORAGE_KEY)).toBeNull();
  });

  it('loads secure-key status from the electron bridge', async () => {
    (window as any).electronAPI = {
      chatbotSecrets: {
        getStatus: vi.fn().mockResolvedValue({ success: true, hasOpenAiApiKey: true }),
      },
    };

    const { result } = renderHook(() => useChatbotPermissions(), { wrapper });

    await waitFor(() => {
      expect(result.current.hasOpenAiApiKey).toBe(true);
    });
    expect(result.current.openAiApiKey).toBe('');
  });

  it('treats non-true stored values as false', () => {
    window.localStorage.setItem('chatbot-enabled', 'yes');
    window.localStorage.setItem('chatbot-transaction-access', '1');
    window.localStorage.setItem('chatbot-category-access', 'on');
    window.localStorage.setItem('chatbot-analytics-access', '');

    const { result } = renderHook(() => useChatbotPermissions(), { wrapper });

    expect(result.current.chatbotEnabled).toBe(false);
    expect(result.current.allowTransactionAccess).toBe(false);
    expect(result.current.allowCategoryAccess).toBe(false);
    expect(result.current.allowAnalyticsAccess).toBe(false);
    expect(result.current.hasOpenAiApiKey).toBe(false);
    expect(result.current.openAiApiKey).toBe('');
  });

  it('updates state and persists only non-sensitive toggles', () => {
    const { result } = renderHook(() => useChatbotPermissions(), { wrapper });

    act(() => {
      result.current.setChatbotEnabled(false);
      result.current.setAllowTransactionAccess(true);
      result.current.setAllowCategoryAccess(true);
      result.current.setAllowAnalyticsAccess(true);
      result.current.setOpenAiApiKey('sk-xyz');
    });

    expect(result.current.chatbotEnabled).toBe(false);
    expect(result.current.allowTransactionAccess).toBe(true);
    expect(result.current.allowCategoryAccess).toBe(true);
    expect(result.current.allowAnalyticsAccess).toBe(true);
    expect(result.current.hasOpenAiApiKey).toBe(true);
    expect(result.current.openAiApiKey).toBe('sk-xyz');

    expect(window.localStorage.getItem('chatbot-enabled')).toBe('false');
    expect(window.localStorage.getItem('chatbot-transaction-access')).toBe('true');
    expect(window.localStorage.getItem('chatbot-category-access')).toBe('true');
    expect(window.localStorage.getItem('chatbot-analytics-access')).toBe('true');
    expect(window.localStorage.getItem(OPENAI_API_KEY_STORAGE_KEY)).toBeNull();
    expect((window as any)[OPENAI_API_KEY_BOOTSTRAP_KEY]).toBe('sk-xyz');
  });

  it('persists API keys through the electron bridge when available', async () => {
    const setOpenAiApiKey = vi.fn().mockResolvedValue({ success: true, hasOpenAiApiKey: true });
    (window as any).electronAPI = {
      chatbotSecrets: {
        getStatus: vi.fn().mockResolvedValue({ success: true, hasOpenAiApiKey: false }),
        setOpenAiApiKey,
      },
    };

    const { result } = renderHook(() => useChatbotPermissions(), { wrapper });

    act(() => {
      result.current.setOpenAiApiKey('sk-secure');
    });

    await waitFor(() => {
      expect(setOpenAiApiKey).toHaveBeenCalledWith('sk-secure');
    });
    expect(result.current.hasOpenAiApiKey).toBe(true);
  });

  it('falls back to defaults when storage read throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('read-fail');
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { result } = renderHook(() => useChatbotPermissions(), { wrapper });

    expect(result.current.chatbotEnabled).toBe(true);
    expect(result.current.allowTransactionAccess).toBe(false);
    expect(result.current.allowCategoryAccess).toBe(false);
    expect(result.current.allowAnalyticsAccess).toBe(false);
    expect(result.current.hasOpenAiApiKey).toBe(false);
    expect(result.current.openAiApiKey).toBe('');
    expect(warnSpy).toHaveBeenCalled();
  });

  it('updates state even when localStorage writes fail', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('write-fail');
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { result } = renderHook(() => useChatbotPermissions(), { wrapper });

    expect(() =>
      act(() => {
        result.current.setAllowAnalyticsAccess(true);
      }),
    ).not.toThrow();

    expect(result.current.allowAnalyticsAccess).toBe(true);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('throws when hook is used outside provider', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => renderHook(() => useChatbotPermissions())).toThrow(
      'useChatbotPermissions must be used within ChatbotPermissionsProvider',
    );

    consoleError.mockRestore();
  });
});
