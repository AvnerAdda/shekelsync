import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider, useLocaleSettings } from '@renderer/i18n/I18nProvider';
import i18n, { initializeI18n } from '@renderer/i18n';

const LocaleConsumer: React.FC = () => {
  const { locale, direction, detectedLocale, setLocale } = useLocaleSettings();
  return (
    <div>
      <span data-testid="locale">{locale}</span>
      <span data-testid="direction">{direction}</span>
      <span data-testid="detected-locale">{detectedLocale}</span>
      <button
        type="button"
        data-testid="toggle-locale"
        onClick={() => setLocale(locale === 'he' ? 'en' : 'he')}
      >
        toggle
      </button>
    </div>
  );
};

const mockNavigatorLocale = (language: string, languages: string[] = [language]) => {
  vi.spyOn(window.navigator, 'language', 'get').mockReturnValue(language);
  vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(languages);
};

describe('I18nProvider', () => {
  const originalLang = document.documentElement.lang;
  const originalDir = document.documentElement.dir;

  beforeAll(() => {
    initializeI18n('he');
  });

  beforeEach(async () => {
    localStorage.clear();
    document.documentElement.lang = originalLang;
    document.documentElement.dir = originalDir;
    await i18n.changeLanguage('he');
  });

  it('prefers a stored locale over the system locale and updates document attributes', async () => {
    localStorage.setItem('app-locale', 'fr');
    mockNavigatorLocale('en-US');

    render(
      <I18nProvider>
        <LocaleConsumer />
      </I18nProvider>,
    );

    expect(screen.getByTestId('locale').textContent).toBe('fr');
    expect(screen.getByTestId('direction').textContent).toBe('ltr');
    expect(screen.getByTestId('detected-locale').textContent).toBe('en');

    await waitFor(() => {
      expect(document.documentElement.lang).toBe('fr');
      expect(document.documentElement.dir).toBe('ltr');
    });
  });

  it('falls back to the system locale when no preference is stored and marks RTL for Hebrew', async () => {
    mockNavigatorLocale('he-IL', ['he-IL', 'en-US']);

    render(
      <I18nProvider>
        <LocaleConsumer />
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('locale').textContent).toBe('he');
    });
    expect(screen.getByTestId('detected-locale').textContent).toBe('he');
    expect(screen.getByTestId('direction').textContent).toBe('rtl');
    await waitFor(() => {
      expect(document.documentElement.dir).toBe('rtl');
    });
  });

  it('persists user locale changes, updates document metadata, and switches i18n language', async () => {
    localStorage.setItem('app-locale', 'he');
    mockNavigatorLocale('en-US');
    const changeLanguageSpy = vi.spyOn(i18n, 'changeLanguage');

    render(
      <I18nProvider>
        <LocaleConsumer />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByTestId('toggle-locale'));

    await waitFor(() => {
      expect(screen.getByTestId('locale').textContent).toBe('en');
      expect(localStorage.getItem('app-locale')).toBe('en');
      expect(document.documentElement.lang).toBe('en');
      expect(document.documentElement.dir).toBe('ltr');
    });

    const changeCalls = changeLanguageSpy.mock.calls.map((call) => call[0]);
    expect(changeCalls).toContain('en');
  });

  it('defaults to Hebrew when no valid locale is available', async () => {
    mockNavigatorLocale('es-ES', ['es-ES', 'de-DE']);

    render(
      <I18nProvider>
        <LocaleConsumer />
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('locale').textContent).toBe('he');
      expect(screen.getByTestId('detected-locale').textContent).toBe('he');
    });

    await waitFor(() => {
      expect(document.documentElement.lang).toBe('he');
      expect(document.documentElement.dir).toBe('rtl');
    });
  });

  it('throws when locale settings hook is used outside of the provider', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => render(<LocaleConsumer />)).toThrow(
      'useLocaleSettings must be used within I18nProvider',
    );

    consoleSpy.mockRestore();
  });
});

describe('initializeI18n', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('he');
  });

  it('switches languages when already initialized', async () => {
    const changeLanguageSpy = vi.spyOn(i18n, 'changeLanguage');

    initializeI18n('fr');

    await waitFor(() => {
      expect(changeLanguageSpy).toHaveBeenCalledWith('fr');
    });
  });
});
