import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { ChatbotPermissionsProvider, useChatbotPermissions } from '../ChatbotPermissionsContext';

const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ChatbotPermissionsProvider>{children}</ChatbotPermissionsProvider>
);

describe('ChatbotPermissionsContext', () => {
  beforeEach(() => {
    window.localStorage.clear();
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
  });

  it('initializes from persisted localStorage flags', () => {
    window.localStorage.setItem('chatbot-enabled', 'false');
    window.localStorage.setItem('chatbot-transaction-access', 'true');
    window.localStorage.setItem('chatbot-category-access', 'true');
    window.localStorage.setItem('chatbot-analytics-access', 'false');

    const { result } = renderHook(() => useChatbotPermissions(), { wrapper });

    expect(result.current.chatbotEnabled).toBe(false);
    expect(result.current.allowTransactionAccess).toBe(true);
    expect(result.current.allowCategoryAccess).toBe(true);
    expect(result.current.allowAnalyticsAccess).toBe(false);
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
  });

  it('updates state and persists each toggle', () => {
    const { result } = renderHook(() => useChatbotPermissions(), { wrapper });

    act(() => {
      result.current.setChatbotEnabled(false);
      result.current.setAllowTransactionAccess(true);
      result.current.setAllowCategoryAccess(true);
      result.current.setAllowAnalyticsAccess(true);
    });

    expect(result.current.chatbotEnabled).toBe(false);
    expect(result.current.allowTransactionAccess).toBe(true);
    expect(result.current.allowCategoryAccess).toBe(true);
    expect(result.current.allowAnalyticsAccess).toBe(true);

    expect(window.localStorage.getItem('chatbot-enabled')).toBe('false');
    expect(window.localStorage.getItem('chatbot-transaction-access')).toBe('true');
    expect(window.localStorage.getItem('chatbot-category-access')).toBe('true');
    expect(window.localStorage.getItem('chatbot-analytics-access')).toBe('true');
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

    expect(warnSpy).toHaveBeenCalled();
  });

  it('updates state even when storage writes fail', () => {
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
