import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import createCache from '@emotion/cache';
import { CacheProvider } from '@emotion/react';
import rtlPlugin from 'stylis-plugin-rtl';
import { ThemeProvider } from '@mui/material/styles';
import { createTheme as createMuiTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';

type ThemeMode = 'light' | 'dark' | 'system';
type FontSize = 'small' | 'medium' | 'large';

interface ThemeContextType {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  actualTheme: 'light' | 'dark';
  fontSize: FontSize;
  setFontSize: (size: FontSize) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const useThemeMode = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useThemeMode must be used within ThemeContextProvider');
  }
  return context;
};

interface ThemeContextProviderProps {
  children: React.ReactNode;
  direction?: 'ltr' | 'rtl';
}

export const ThemeContextProvider: React.FC<ThemeContextProviderProps> = ({
  children,
  direction = 'ltr',
}) => {
  const [mode, setMode] = useState<ThemeMode>('system');
  const [actualTheme, setActualTheme] = useState<'light' | 'dark'>('light');
  const [fontSize, setFontSizeState] = useState<FontSize>('medium');
  const ltrCache = useMemo(() => createCache({ key: 'mui-ltr', prepend: true }), []);
  const rtlCache = useMemo(
    () => createCache({ key: 'mui-rtl', stylisPlugins: [rtlPlugin], prepend: true }),
    [],
  );

  useEffect(() => {
    // Load saved preferences
    const savedMode = localStorage.getItem('theme-mode') as ThemeMode;
    if (savedMode) {
      setMode(savedMode);
    }

    const savedFontSize = localStorage.getItem('font-size') as FontSize;
    if (savedFontSize) {
      setFontSizeState(savedFontSize);
    }
  }, []);

  useEffect(() => {
    // Determine actual theme based on mode
    if (mode === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      setActualTheme(mediaQuery.matches ? 'dark' : 'light');

      const handler = (e: MediaQueryListEvent) => {
        setActualTheme(e.matches ? 'dark' : 'light');
      };

      mediaQuery.addEventListener('change', handler);
      return () => mediaQuery.removeEventListener('change', handler);
    } else {
      setActualTheme(mode);
    }
  }, [mode]);

  const handleSetMode = (newMode: ThemeMode) => {
    setMode(newMode);
    localStorage.setItem('theme-mode', newMode);
  };

  const handleSetFontSize = (newSize: FontSize) => {
    setFontSizeState(newSize);
    localStorage.setItem('font-size', newSize);
  };

  // Calculate font size multiplier
  const fontSizeMultiplier = fontSize === 'small' ? 0.9 : fontSize === 'large' ? 1.1 : 1;

  const theme = useMemo(
    () => createMuiTheme({
      direction,
      palette: {
        mode: actualTheme,
        primary: {
          main: '#c8facf',
          light: '#f8fef9',
          dark: '#9cf5aa',
          contrastText: '#000000',
        },
        secondary: {
          main: '#facfc8',
          light: '#fef9f8',
          dark: '#f5aa9c',
          contrastText: '#000000',
        },
        background: {
          default: actualTheme === 'dark' ? '#0a0a0a' : '#ffffff',
          paper: actualTheme === 'dark' ? '#1e1e1e' : '#ffffff',
        },
        text: {
          primary: actualTheme === 'dark' ? '#ededed' : '#000000',
          secondary: actualTheme === 'dark' ? '#a3a3a3' : '#666666',
        },
        divider: actualTheme === 'dark' ? '#404040' : '#d3d3d3',
      },
      typography: {
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif",
        h1: {
          fontWeight: 800,
          fontSize: `${3.5 * fontSizeMultiplier}rem`,
          letterSpacing: '-0.04em',
          lineHeight: 1.2,
        },
        h2: {
          fontWeight: 700,
          fontSize: `${2.5 * fontSizeMultiplier}rem`,
          letterSpacing: '-0.03em',
          lineHeight: 1.3,
        },
        h3: {
          fontWeight: 700,
          fontSize: `${2 * fontSizeMultiplier}rem`,
          letterSpacing: '-0.02em',
          lineHeight: 1.4,
        },
        h4: {
          fontWeight: 600,
          fontSize: `${1.5 * fontSizeMultiplier}rem`,
          letterSpacing: '-0.01em',
          lineHeight: 1.5,
        },
        h5: {
          fontWeight: 600,
          fontSize: `${1.25 * fontSizeMultiplier}rem`,
          letterSpacing: '-0.01em',
          lineHeight: 1.6,
        },
        h6: {
          fontWeight: 600,
          fontSize: `${1.125 * fontSizeMultiplier}rem`,
          letterSpacing: '-0.005em',
          lineHeight: 1.6,
        },
        body1: {
          fontSize: `${1 * fontSizeMultiplier}rem`,
          lineHeight: 1.7,
          letterSpacing: '0.00938em',
        },
        body2: {
          fontSize: `${0.875 * fontSizeMultiplier}rem`,
          lineHeight: 1.6,
          letterSpacing: '0.01071em',
        },
      },
      spacing: 8,
      components: {
        MuiDrawer: {
          styleOverrides: {
            paper: {
              backgroundColor: actualTheme === 'dark' ? '#1e1e1e' : '#ffffff',
              borderRight: `1px solid ${actualTheme === 'dark' ? '#404040' : '#d3d3d3'}`,
            },
          },
        },
        MuiButton: {
          styleOverrides: {
            root: {
              textTransform: 'none',
              borderRadius: '14px',
              fontWeight: 600,
              padding: '10px 24px',
              transition: 'all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
            },
            contained: {
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.08)',
              '&:hover': {
                boxShadow: '0 8px 24px rgba(0, 0, 0, 0.12)',
                transform: 'translateY(-2px)',
              },
            },
          },
        },
        MuiCard: {
          styleOverrides: {
            root: {
              borderRadius: '20px',
              boxShadow: '0 4px 16px rgba(0, 0, 0, 0.06)',
              transition: 'all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
              backdropFilter: 'blur(12px)',
              background: actualTheme === 'dark'
                ? 'rgba(10, 10, 10, 0.7)'
                : 'rgba(255, 255, 255, 0.85)',
            },
          },
        },
        MuiChip: {
          styleOverrides: {
            root: {
              borderRadius: '12px',
              fontWeight: 500,
              transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
            },
          },
        },
        MuiPaper: {
          styleOverrides: {
            root: {
              borderRadius: '20px',
              backgroundImage: 'none',
            },
            elevation1: {
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.06)',
            },
            elevation2: {
              boxShadow: '0 4px 16px rgba(0, 0, 0, 0.08)',
            },
            elevation3: {
              boxShadow: '0 8px 24px rgba(0, 0, 0, 0.1)',
            },
          },
        },
      },
    }),
    [actualTheme, direction, fontSizeMultiplier],
  );

  return (
    <ThemeContext.Provider value={{ mode, setMode: handleSetMode, actualTheme, fontSize, setFontSize: handleSetFontSize }}>
      <CacheProvider value={direction === 'rtl' ? rtlCache : ltrCache}>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          {children}
        </ThemeProvider>
      </CacheProvider>
    </ThemeContext.Provider>
  );
};
