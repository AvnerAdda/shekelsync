import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import EnhancedProfileSection from '../EnhancedProfileSection';

const getMock = vi.fn();
const putMock = vi.fn();

vi.mock('@/lib/api-client', () => ({
  __esModule: true,
  apiClient: {
    get: (...args: any[]) => getMock(...args),
    put: (...args: any[]) => putMock(...args),
  },
  default: {
    get: (...args: any[]) => getMock(...args),
    put: (...args: any[]) => putMock(...args),
  },
}));

const baseProfileResponse = {
  ok: true,
  status: 200,
  statusText: 'OK',
  data: {
    profile: {
      id: 1,
      username: 'Jane Doe',
      marital_status: 'Single',
      age: 32,
      birth_date: '1993-06-15',
      occupation: 'Engineer',
      monthly_income: 15000,
      family_status: 'Single',
      location: 'Tel Aviv',
      industry: 'Tech',
      children_count: 0,
      household_size: 1,
      home_ownership: 'rent',
      education_level: 'bachelor',
      employment_status: 'employed',
    },
    spouse: null,
    children: [],
  },
};

function renderProfile() {
  const theme = createTheme();
  return render(
    <ThemeProvider theme={theme}>
      <EnhancedProfileSection />
    </ThemeProvider>,
  );
}

describe('EnhancedProfileSection', () => {
  beforeAll(() => {
    (global as any).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    window.scrollTo = vi.fn();
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  beforeEach(() => {
    getMock.mockReset();
    putMock.mockReset();
  });

  it('renders profile data returned from the API', async () => {
    getMock.mockResolvedValueOnce(baseProfileResponse);

    renderProfile();

    expect(await screen.findByDisplayValue('Jane Doe')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save enhanced profile/i })).toBeInTheDocument();
  });

  it('shows a success message after saving profile data', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    getMock.mockResolvedValue(baseProfileResponse);
    putMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      data: baseProfileResponse.data,
    });

    renderProfile();

    await screen.findByDisplayValue('Jane Doe');

    const saveButton = screen.getByRole('button', { name: /save enhanced profile/i });
    fireEvent.click(saveButton);

    await waitFor(() => expect(putMock).toHaveBeenCalled());
    expect(await screen.findByText(/updated successfully/i)).toBeInTheDocument();
    consoleSpy.mockRestore();
  });

  it('shows an error message when saving fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    getMock.mockResolvedValue(baseProfileResponse);
    putMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Server error',
      data: {},
    });

    renderProfile();
    await screen.findByDisplayValue('Jane Doe');

    fireEvent.click(screen.getByRole('button', { name: /save enhanced profile/i }));

    await waitFor(() => expect(putMock).toHaveBeenCalled());
    expect(await screen.findByText(/failed to save profile/i)).toBeInTheDocument();
    consoleSpy.mockRestore();
  });

  it('requires a child birth date before adding', async () => {
    getMock.mockResolvedValue(baseProfileResponse);

    renderProfile();
    await screen.findByDisplayValue('Jane Doe');

    fireEvent.click(screen.getByRole('button', { name: /children information/i }));
    fireEvent.click(screen.getByRole('button', { name: /add child/i }));
    fireEvent.click(screen.getByRole('button', { name: /^add child$/i }));

    expect(await screen.findByText(/birth date is required for children/i)).toBeInTheDocument();
  });

  it('shows a session expiry message when profile fetch returns 401', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    getMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      data: {},
    });

    renderProfile();

    expect(await screen.findByText(/session expired/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save enhanced profile/i })).toBeInTheDocument();
    consoleSpy.mockRestore();
  });

  it('shows a generic message when profile fetch fails for other reasons', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    getMock.mockRejectedValueOnce(new Error('IPC failure'));

    renderProfile();

    expect(await screen.findByText(/failed to load profile/i)).toBeInTheDocument();
    consoleSpy.mockRestore();
  });
});
