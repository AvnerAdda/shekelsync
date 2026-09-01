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
          main: actualTheme === 'dark' ? '#86D19A' : '#2F6B4F',
          light: actualTheme === 'dark' ? '#B6E5C2' : '#5A9274',
          dark: actualTheme === 'dark' ? '#5DAF75' : '#204B38',
          contrastText: actualTheme === 'dark' ? '#102218' : '#FFFFFF',
        },
        secondary: {
          main: actualTheme === 'dark' ? '#E7A174' : '#B96837',
          light: actualTheme === 'dark' ? '#F0BE9E' : '#D39167',
          dark: actualTheme === 'dark' ? '#C77B4D' : '#864823',
          contrastText: actualTheme === 'dark' ? '#25150C' : '#FFFFFF',
        },
        success: {
          main: actualTheme === 'dark' ? '#72C58D' : '#287A4B',
        },
        warning: {
          main: actualTheme === 'dark' ? '#E2B861' : '#A76A13',
        },
        error: {
          main: actualTheme === 'dark' ? '#EB8C83' : '#B84F47',
        },
        info: {
          main: actualTheme === 'dark' ? '#79B8DB' : '#36799D',
        },
        background: {
          default: actualTheme === 'dark' ? '#0F1512' : '#F3F5F1',
          paper: actualTheme === 'dark' ? '#18201B' : '#FEFFFC',
        },
        text: {
          primary: actualTheme === 'dark' ? '#EEF3EF' : '#1B2720',
          secondary: actualTheme === 'dark' ? '#A7B3AA' : '#647168',
        },
        divider: actualTheme === 'dark' ? '#334039' : '#DCE3DD',
      },
      typography: {
        fontFamily: "'Inter Variable', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        h1: {
          fontWeight: 780,
          fontSize: `${2.5 * fontSizeMultiplier}rem`,
          letterSpacing: '-0.035em',
          lineHeight: 1.12,
        },
        h2: {
          fontWeight: 750,
          fontSize: `${2 * fontSizeMultiplier}rem`,
          letterSpacing: '-0.028em',
          lineHeight: 1.18,
        },
        h3: {
          fontWeight: 720,
          fontSize: `${1.65 * fontSizeMultiplier}rem`,
          letterSpacing: '-0.02em',
          lineHeight: 1.25,
        },
        h4: {
          fontWeight: 700,
          fontSize: `${1.4 * fontSizeMultiplier}rem`,
          letterSpacing: '-0.01em',
          lineHeight: 1.5,
        },
        h5: {
          fontWeight: 680,
          fontSize: `${1.25 * fontSizeMultiplier}rem`,
          letterSpacing: '-0.01em',
          lineHeight: 1.6,
        },
        h6: {
          fontWeight: 680,
          fontSize: `${1.125 * fontSizeMultiplier}rem`,
          letterSpacing: '-0.005em',
          lineHeight: 1.6,
        },
        body1: {
          fontSize: `${1 * fontSizeMultiplier}rem`,
          lineHeight: 1.6,
          letterSpacing: '0.00938em',
        },
        body2: {
          fontSize: `${0.875 * fontSizeMultiplier}rem`,
          lineHeight: 1.6,
          letterSpacing: '0.01071em',
        },
      },
      spacing: 8,
      shape: {
        borderRadius: 12,
      },
      components: {
        MuiDrawer: {
          styleOverrides: {
            paper: {
              backgroundColor: actualTheme === 'dark' ? '#141B17' : '#F9FAF7',
              borderRight: `1px solid ${actualTheme === 'dark' ? '#334039' : '#DCE3DD'}`,
            },
          },
        },
        MuiButton: {
          styleOverrides: {
            root: {
              textTransform: 'none',
              borderRadius: '10px',
              fontWeight: 600,
              padding: '9px 18px',
              transition: 'background-color 160ms ease, border-color 160ms ease, box-shadow 160ms ease',
            },
            contained: {
              boxShadow: '0 1px 2px rgba(16, 34, 24, 0.12)',
              '&:hover': {
                boxShadow: '0 3px 8px rgba(16, 34, 24, 0.14)',
              },
            },
          },
        },
        MuiCard: {
          styleOverrides: {
            root: {
              borderRadius: '16px',
              border: `1px solid ${actualTheme === 'dark' ? '#334039' : '#E1E6E1'}`,
              boxShadow: actualTheme === 'dark'
                ? '0 8px 24px rgba(0, 0, 0, 0.18)'
                : '0 8px 24px rgba(32, 54, 41, 0.055)',
              transition: 'border-color 160ms ease, box-shadow 160ms ease',
              background: actualTheme === 'dark' ? '#18201B' : '#FEFFFC',
            },
          },
        },
        MuiChip: {
          styleOverrides: {
            root: {
              borderRadius: '999px',
              fontWeight: 600,
              transition: 'background-color 160ms ease, border-color 160ms ease',
            },
          },
        },
        MuiPaper: {
          styleOverrides: {
            root: {
              borderRadius: '16px',
              backgroundImage: 'none',
            },
            elevation1: {
              boxShadow: '0 2px 8px rgba(23, 45, 31, 0.06)',
            },
            elevation2: {
              boxShadow: '0 8px 22px rgba(23, 45, 31, 0.08)',
            },
            elevation3: {
              boxShadow: '0 12px 30px rgba(23, 45, 31, 0.1)',
            },
          },
        },
        MuiToggleButton: {
          styleOverrides: {
            root: {
              borderRadius: '9px',
              textTransform: 'none',
              fontWeight: 650,
            },
          },
        },
        MuiAlert: {
          styleOverrides: {
            root: {
              borderRadius: '12px',
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
