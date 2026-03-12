import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import GlobalTransactionSearch from '../components/GlobalTransactionSearch';

const mockGet = vi.fn();

function translate(template: string, options?: Record<string, unknown>) {
  if (!options) {
    return template;
  }

  return template.replace(/\{\{(.*?)\}\}/g, (_match, key) => {
    const value = options[key.trim()];
    return value === undefined || value === null ? '' : String(value);
  });
}

function mockT(
  key: string,
  defaultValueOrOptions?: string | Record<string, unknown>,
  maybeOptions?: Record<string, unknown>,
) {
  if (typeof defaultValueOrOptions === 'string') {
    return translate(defaultValueOrOptions, maybeOptions);
  }

  if (typeof defaultValueOrOptions?.defaultValue === 'string') {
    return translate(defaultValueOrOptions.defaultValue, defaultValueOrOptions);
  }

  return key;
}

const translationMock = {
  t: mockT,
  i18n: { language: 'en' },
};

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
  },
}));

vi.mock('@mui/material', () => {
  const component = (tag: any) => {
    const MockComponent = ({ children, ...props }: { children?: React.ReactNode }) =>
      React.createElement(tag, props, children);
    MockComponent.displayName = `MockMui${String(tag)}`;
    return MockComponent;
  };

  return {
    Dialog: ({ open, children }: { open: boolean; children?: React.ReactNode }) => (open ? <div>{children}</div> : null),
    DialogContent: component('div'),
    Box: component('div'),
    Typography: component('span'),
    List: component('div'),
    ListItem: component('div'),
    ListItemButton: ({ children, onClick }: { children?: React.ReactNode; onClick?: () => void }) => (
      <button onClick={onClick}>{children}</button>
    ),
    ListItemText: ({ primary, secondary }: { primary?: React.ReactNode; secondary?: React.ReactNode }) => (
      <div>
        <div>{primary}</div>
        <div>{secondary}</div>
      </div>
    ),
    ListItemIcon: component('div'),
    Chip: ({ label }: { label?: React.ReactNode }) => <span>{label}</span>,
    CircularProgress: () => <div role="progressbar" />,
    InputAdornment: component('span'),
    Divider: () => <hr />,
    IconButton: ({ children, onClick, 'aria-label': ariaLabel }: { children?: React.ReactNode; onClick?: () => void; 'aria-label'?: string }) => (
      <button onClick={onClick} aria-label={ariaLabel}>{children}</button>
    ),
    Tooltip: ({ children }: { children: React.ReactElement }) => children,
    MenuItem: ({ children, value }: { children?: React.ReactNode; value?: string }) => (
      <option value={value}>
        {React.Children.map(children, (child) => (
          React.isValidElement(child) && child.type === 'em'
            ? child.props.children
            : child
        ))}
      </option>
    ),
    Stack: component('div'),
    useTheme: () => ({
      palette: {
        text: { secondary: '#666', primary: '#111' },
        primary: { main: '#123' },
        secondary: { main: '#456' },
        success: { main: '#0a0' },
        error: { main: '#a00' },
        info: { main: '#00a' },
        background: { paper: '#fff' },
        common: { black: '#000' },
        divider: '#ddd',
      },
    }),
    TextField: ({
      label,
      placeholder,
      value,
      onChange,
      onKeyDown,
      inputRef,
      select,
      children,
      'aria-label': ariaLabel,
      InputLabelProps,
      type,
    }: {
      label?: string;
      placeholder?: string;
      value?: string;
      onChange?: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void;
      onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
      inputRef?: React.Ref<HTMLInputElement>;
      select?: boolean;
      children?: React.ReactNode;
      'aria-label'?: string;
      InputLabelProps?: { shrink?: boolean };
      type?: string;
    }) => (
      <label>
        <span>{label}</span>
        {select ? (
          <select
            aria-label={label}
            value={value}
            onChange={onChange as any}
          >
            {children}
          </select>
        ) : (
          <input
            ref={inputRef}
            aria-label={ariaLabel || label || placeholder}
            placeholder={placeholder}
            value={value}
            onChange={onChange as any}
            onKeyDown={onKeyDown}
            data-shrink={InputLabelProps?.shrink ? 'true' : 'false'}
            type={type}
          />
        )}
      </label>
    ),
  };
});

vi.mock('@mui/material/styles', () => ({
  alpha: (_color: string, _value: number) => 'rgba(0,0,0,0.1)',
}));

vi.mock('@mui/icons-material', () => {
  const icon = (name: string) => {
    const MockIcon = () => <span>{name}</span>;
    MockIcon.displayName = `MockIcon${name}`;
    return MockIcon;
  };

  return {
    Search: icon('Search'),
    Close: icon('Close'),
    Receipt: icon('Receipt'),
    ArrowUpward: icon('ArrowUpward'),
    ArrowDownward: icon('ArrowDownward'),
    TrendingUp: icon('TrendingUp'),
    Notes: icon('Notes'),
    LocalOffer: icon('LocalOffer'),
    Store: icon('Store'),
    Category: icon('Category'),
    CalendarMonth: icon('CalendarMonth'),
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => translationMock,
}));

describe('GlobalTransactionSearch', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockGet.mockImplementation((endpoint: string) => {
      if (endpoint === '/api/categories/hierarchy') {
        return Promise.resolve({
          ok: true,
          data: {
            categories: [
              { id: 7, name: 'Groceries', parent_id: null },
            ],
          },
        });
      }

      if (endpoint === '/api/transactions/tags') {
        return Promise.resolve({
          ok: true,
          data: ['fresh', 'weekly'],
        });
      }

      if (endpoint === '/api/transactions/search') {
        return Promise.resolve({
          ok: true,
          data: {
            transactions: [],
            count: 0,
            searchQuery: '',
            filters: {},
          },
        });
      }

      return Promise.resolve({ ok: true, data: {} });
    });
  });

  it('builds the search request from the current filter state', async () => {
    render(
      <GlobalTransactionSearch
        open
        onClose={vi.fn()}
        initialFilters={{
          query: 'milk',
          vendor: 'Mega Store',
          category: '7',
          tag: 'fresh',
          startDate: '2026-03-01',
          endDate: '2026-03-10',
        }}
        onOpenTransaction={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/api/transactions/search', {
        params: {
          query: 'milk',
          vendor: 'Mega Store',
          category: '7',
          tag: 'fresh',
          startDate: '2026-03-01',
          endDate: '2026-03-10',
          limit: 20,
        },
      });
    });
  });

  it('resets query and filters after close and reopen', async () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <GlobalTransactionSearch
        open
        onClose={onClose}
        initialFilters={{
          query: 'milk',
          vendor: 'Mega Store',
        }}
        onOpenTransaction={vi.fn()}
      />,
    );

    rerender(
      <GlobalTransactionSearch
        open={false}
        onClose={onClose}
        initialFilters={null}
        onOpenTransaction={vi.fn()}
      />,
    );

    rerender(
      <GlobalTransactionSearch
        open
        onClose={onClose}
        initialFilters={null}
        onOpenTransaction={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByLabelText('Search transactions...')).toHaveValue('');
      expect(screen.getByLabelText('Vendor')).toHaveValue('');
    });
  });
});
