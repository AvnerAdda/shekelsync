import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DonationModal from '../components/DonationModal';
import { useDonationStatus } from '../hooks/useDonationStatus';
import { openDonationUrl } from '../utils/openDonationUrl';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string; [k: string]: unknown }) => options?.defaultValue || key,
  }),
}));

vi.mock('@mui/material', () => {
  const component = (tag: any) =>
    ({ children }: { children?: React.ReactNode }) => React.createElement(tag, null, children);

  return {
    Alert: component('div'),
    Box: component('div'),
    Button: ({ children, onClick, disabled }: { children?: React.ReactNode; onClick?: () => void; disabled?: boolean }) => (
      <button disabled={disabled} onClick={onClick}>
        {children}
      </button>
    ),
    Chip: ({ label }: { label?: React.ReactNode }) => <span>{label}</span>,
    CircularProgress: () => <span>loading</span>,
    Dialog: ({ open, children }: { open: boolean; children?: React.ReactNode }) => (open ? <div>{children}</div> : null),
    DialogActions: component('div'),
    DialogContent: component('div'),
    DialogTitle: component('h2'),
    Divider: component('hr'),
    IconButton: ({ children, onClick }: { children?: React.ReactNode; onClick?: () => void }) => (
      <button onClick={onClick}>{children}</button>
    ),
    Stack: component('div'),
    Typography: ({ children, component: Component = 'span' }: { children?: React.ReactNode; component?: keyof JSX.IntrinsicElements }) => (
      <Component>{children}</Component>
    ),
    useTheme: () => ({
      palette: {
        divider: '#ddd',
        mode: 'light',
        background: { paper: '#fff' },
      },
    }),
  };
});

vi.mock('@mui/icons-material', () => ({
  CheckCircle: () => <span>verified</span>,
  Close: () => <span>close</span>,
  HourglassTop: () => <span>pending</span>,
  LocalCafe: () => <span>coffee</span>,
  WorkspacePremium: () => <span>tier</span>,
}));

vi.mock('../hooks/useDonationStatus', () => ({
  useDonationStatus: vi.fn(),
}));

vi.mock('../utils/openDonationUrl', () => ({
  openDonationUrl: vi.fn(),
}));

const mockUseDonationStatus = vi.mocked(useDonationStatus);
const mockOpenDonationUrl = vi.mocked(openDonationUrl);

const baseStatus = {
  hasDonated: false,
  tier: 'none',
  supportStatus: 'none',
  totalAmountUsd: 0,
  currentPlanKey: null,
  pendingPlanKey: null,
  hasPendingVerification: false,
  lastVerifiedAt: null,
  billingCycle: null,
  canAccessAiAgent: false,
  aiAgentAccessLevel: 'none',
  currentMonthKey: '2026-02',
  reminderShownThisMonth: false,
  shouldShowMonthlyReminder: true,
  donationUrl: 'https://buymeacoffee.com/shekelsync',
  plans: [
    {
      key: 'bronze',
      tier: 'bronze',
      title: 'Bronze',
      trialLabel: null,
      priceLabel: '$5 / month',
      billingCycle: 'monthly',
      amountUsd: 5,
      rewards: ['Access to AI Agent'],
      aiAccessLevel: 'standard',
    },
  ],
} as const;

type DonationHookReturn = ReturnType<typeof useDonationStatus>;

function setupHook(overrides: Partial<DonationHookReturn> = {}) {
  const createSupportIntent = vi.fn().mockResolvedValue(baseStatus);

  mockUseDonationStatus.mockReturnValue({
    status: baseStatus as any,
    loading: false,
    error: null,
    hasDonated: false,
    tier: 'none',
    supportStatus: 'none',
    refresh: vi.fn(),
    createSupportIntent,
    addDonationEvent: vi.fn(),
    markReminderShown: vi.fn(),
    ...overrides,
  });

  return {
    createSupportIntent: (overrides.createSupportIntent as ReturnType<typeof vi.fn>) || createSupportIntent,
  };
}

describe('DonationModal', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockOpenDonationUrl.mockReset();
  });

  it('renders a single dialog heading title', () => {
    setupHook();

    render(<DonationModal open onClose={vi.fn()} />);

    expect(
      screen.getByRole('heading', { name: /Buy Me a Coffee Support Program/i }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('heading')).toHaveLength(1);
  });

  it('submits selected plan and opens donation url', async () => {
    const nextStatus = {
      ...baseStatus,
      pendingPlanKey: 'bronze',
      supportStatus: 'pending',
      donationUrl: 'https://buymeacoffee.com/shekelsync/new-link',
    };
    const onDonationRecorded = vi.fn();
    const mockedIntent = vi.fn().mockResolvedValue(nextStatus);
    const { createSupportIntent } = setupHook({
      createSupportIntent: mockedIntent as any,
    });

    render(
      <DonationModal
        open
        onClose={vi.fn()}
        onDonationRecorded={onDonationRecorded}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Choose on Buy Me a Coffee' }));

    await waitFor(() => {
      expect(createSupportIntent).toHaveBeenCalledWith({
        planKey: 'bronze',
        source: 'support_modal',
      });
    });

    expect(mockOpenDonationUrl).toHaveBeenCalledWith('https://buymeacoffee.com/shekelsync/new-link');
    expect(onDonationRecorded).toHaveBeenCalledWith(nextStatus);
  });

  it('shows action error when plan submission fails', async () => {
    setupHook({
      createSupportIntent: vi.fn().mockRejectedValue(new Error('intent failed')) as any,
    });

    render(<DonationModal open onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Choose on Buy Me a Coffee' }));

    await waitFor(() => {
      expect(screen.getByText('intent failed')).toBeInTheDocument();
    });

    expect(mockOpenDonationUrl).not.toHaveBeenCalled();
  });
});
