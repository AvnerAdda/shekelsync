import type { ComponentProps } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import type {
  PortfolioSummary,
  PortfolioHistoryPoint,
  InvestmentAccountSummary,
} from '@renderer/types/investments';
import PortfolioBreakdownSection from '../PortfolioBreakdownSection';

const mockTheme = {
  palette: {
    primary: { main: '#1976d2', light: '#bbdefb' },
    success: { main: '#2e7d32' },
    error: { main: '#d32f2f' },
    text: { secondary: '#555', primary: '#111', disabled: '#999' },
    divider: '#e0e0e0',
    background: { paper: '#fff' },
    grey: { 300: '#e0e0e0', 700: '#616161' },
    mode: 'light',
    info: { main: '#0288d1' },
    warning: { main: '#ed6c02' },
  },
  shape: { borderRadius: 4 },
};

vi.mock('@mui/material', () => {
  const React = require('react');
  const createComponent =
    (Tag = 'div') =>
    ({ children, ...props }: any) => {
      const { gutterBottom, disablePadding, expandIcon, ...rest } = props;
      return React.createElement(Tag, rest, children);
    };

  const ListItemText = ({ primary, secondary }: any) => (
    <div>
      {primary}
      {secondary}
    </div>
  );

  const Collapse = ({ in: inProp, children }: any) => (inProp ? <div>{children}</div> : null);

  const IconButton = ({ children, onClick, ...props }: any) => (
    <button type="button" onClick={onClick} {...props}>
      {children}
    </button>
  );

  const CircularProgress = () => <div role="progressbar" />;

  const Dialog = ({ children, open, ...rest }: any) =>
    open ? React.createElement('div', rest, children) : null;
  const DialogContent = createComponent('div');
  const DialogTitle = createComponent('div');
  const DialogActions = createComponent('div');
  const FormControl = createComponent('div');
  const InputLabel = createComponent('label');
  const Select = ({ children, ...props }: any) => <select {...props}>{children}</select>;
  const MenuItem = ({ children, value }: any) => <option value={value}>{children}</option>;
  const Button = ({ children, onClick, ...props }: any) => (
    <button type="button" onClick={onClick} {...props}>
      {children}
    </button>
  );
  const Card = createComponent('div');
  const Grid = createComponent('div');
  const Alert = createComponent('div');
  const Divider = createComponent('div');

  return {
    Box: createComponent('div'),
    Typography: createComponent('span'),
    Paper: createComponent('section'),
    Accordion: createComponent('div'),
    AccordionSummary: createComponent('div'),
    AccordionDetails: createComponent('div'),
    List: createComponent('div'),
    ListItem: createComponent('div'),
    ListItemText,
    IconButton,
    Collapse,
    CircularProgress,
    Dialog,
    DialogContent,
    DialogTitle,
    DialogActions,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    Button,
    Card,
    Grid,
    Alert,
    Divider,
    useTheme: () => mockTheme,
  };
});

const mockFormatCurrency = vi.fn((value: number) => `₪${value}`);
const mockUseInvestmentsFilters = vi.fn();

vi.mock('@app/contexts/FinancePrivacyContext', () => ({
  useFinancePrivacy: () => ({
    maskAmounts: false,
    formatCurrency: mockFormatCurrency,
  }),
}));

vi.mock('../../InvestmentsFiltersContext', () => ({
  useInvestmentsFilters: () => mockUseInvestmentsFilters(),
}));

vi.mock('recharts', () => {
  const Container = ({ children }: any) => <div data-testid="recharts-container">{children}</div>;
  const Leaf = () => <div data-testid="recharts-leaf" />;
  return {
    ResponsiveContainer: Container,
    LineChart: Container,
    Line: Leaf,
    XAxis: Leaf,
    YAxis: Leaf,
    CartesianGrid: Leaf,
    Legend: Leaf,
    Tooltip: Leaf,
  };
});

vi.mock('@mui/icons-material', () => {
  const React = require('react');
  const Icon = (props: any) => <span {...props} />;
  return {
    ExpandMore: Icon,
    Timeline: Icon,
    Close: Icon,
    AccountBalance: Icon,
    School: Icon,
    ShowChart: Icon,
    CurrencyBitcoin: Icon,
    Savings: Icon,
    CreditCard: Icon,
    Dashboard: Icon,
    AttachMoney: Icon,
    Search: Icon,
    Add: Icon,
    Refresh: Icon,
  };
});

type ComponentPropsType = ComponentProps<typeof PortfolioBreakdownSection>;

const createAccount = (): InvestmentAccountSummary => ({
  id: 1,
  account_name: 'Alpha Brokerage',
  account_type: 'brokerage',
  institution: 'Alpha Bank',
  investment_category: 'liquid',
  currency: 'ILS',
  current_value: 100000,
  cost_basis: 80000,
  as_of_date: '2024-01-01',
  assets: [
    {
      asset_name: 'ETF',
      asset_type: 'equity',
      current_value: 50000,
      cost_basis: 40000,
    },
  ],
});

const createBreakdown = (): PortfolioSummary['breakdown'] => [
  {
    type: 'liquid',
    name: 'Brokerage Accounts',
    name_he: 'ברוקראז׳',
    totalValue: 100000,
    totalCost: 80000,
    count: 1,
    percentage: 66.7,
    accounts: [createAccount()],
  },
];

const createSummary = (): PortfolioSummary['summary'] => ({
  totalPortfolioValue: 150000,
  totalCostBasis: 120000,
  unrealizedGainLoss: 30000,
  roi: 0.25,
  totalAccounts: 2,
  accountsWithValues: 2,
  newestUpdateDate: '2024-01-01',
  liquid: {
    totalValue: 100000,
    totalCost: 80000,
    unrealizedGainLoss: 20000,
    roi: 0.25,
    accountsCount: 1,
  },
  restricted: {
    totalValue: 50000,
    totalCost: 40000,
    unrealizedGainLoss: 10000,
    roi: 0.25,
    accountsCount: 1,
  },
});

const buildPortfolioData = (breakdown = createBreakdown()): PortfolioSummary => ({
  summary: createSummary(),
  breakdown,
  timeline: [],
  accounts: breakdown.flatMap((group) => group.accounts ?? []),
  liquidAccounts: [],
  restrictedAccounts: [],
});

const createAccountHistories = (): Record<number, PortfolioHistoryPoint[]> => ({
  1: [
    { date: '2024-01-01', currentValue: 90000, costBasis: 80000 },
    { date: '2024-02-01', currentValue: 100000, costBasis: 80000 },
  ],
});

const renderComponent = (props?: Partial<ComponentPropsType>) => {
  const defaultProps: ComponentPropsType = {
    portfolioData: buildPortfolioData(),
    accountHistories: createAccountHistories(),
    historyLoading: false,
  };

  return render(<PortfolioBreakdownSection {...defaultProps} {...props} />);
};

describe('PortfolioBreakdownSection', () => {
  beforeEach(() => {
    mockFormatCurrency.mockClear();
    mockUseInvestmentsFilters.mockReset();
    mockUseInvestmentsFilters.mockReturnValue({
      historyTimeRange: '3m',
    });
  });

  it('returns null when there is no breakdown data', () => {
    const { container } = renderComponent({
      portfolioData: buildPortfolioData([]),
    });

    expect(container.firstChild).toBeNull();
  });

  it('renders accounts with formatted values and toggles history chart', () => {
    renderComponent();

    expect(screen.getByText('Portfolio Breakdown')).toBeInTheDocument();
    expect(screen.getByText('Brokerage Accounts')).toBeInTheDocument();
    expect(screen.getByText('Alpha Brokerage')).toBeInTheDocument();
    expect(screen.getByText('25.0% ROI')).toBeInTheDocument();

    expect(mockFormatCurrency).toHaveBeenCalledWith(100000, {
      absolute: true,
      maximumFractionDigits: 0,
    });

    const toggleButton = screen.getByRole('button', { name: /toggle performance chart/i });
    fireEvent.click(toggleButton);
    expect(screen.getByText(/Performance Over Time \(3m\)/)).toBeInTheDocument();

    const closeButton = screen.getByRole('button', { name: /close chart/i });
    fireEvent.click(closeButton);
    expect(screen.queryByText(/Performance Over Time/)).not.toBeInTheDocument();
  });

  it('displays a loading indicator when history data is still loading', () => {
    renderComponent({ historyLoading: true });

    const toggleButton = screen.getByRole('button', { name: /toggle performance chart/i });
    fireEvent.click(toggleButton);

    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });
});
