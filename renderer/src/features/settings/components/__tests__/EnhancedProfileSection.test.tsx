import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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

vi.mock('@app/contexts/OnboardingContext', () => ({
  useOnboarding: () => ({
    status: { completedSteps: {} },
    loading: false,
    error: null,
    refetch: vi.fn(),
    dismissOnboarding: vi.fn(),
    markStepComplete: vi.fn(),
    getPageAccessStatus: vi.fn(() => ({ isLocked: false, requiredStep: '', reason: '' })),
  }),
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

function cloneBaseResponse() {
  return JSON.parse(JSON.stringify(baseProfileResponse));
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
    expect(screen.getByRole('button', { name: /save profile/i })).toBeInTheDocument();
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

    await waitFor(() => expect(getMock).toHaveBeenCalled());
    await screen.findByDisplayValue('Jane Doe');

    const saveButton = screen.getByRole('button', { name: /save profile/i });
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

    fireEvent.click(screen.getByRole('button', { name: /save profile/i }));

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

    await waitFor(() => expect(getMock).toHaveBeenCalled());
    expect(await screen.findByText(/session expired/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save profile/i })).toBeInTheDocument();
    consoleSpy.mockRestore();
  });

  it('shows a generic message when profile fetch fails for other reasons', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    getMock.mockRejectedValueOnce(new Error('IPC failure'));

    renderProfile();

    await waitFor(() => expect(getMock).toHaveBeenCalled());
    expect(await screen.findByText(/failed to load profile/i)).toBeInTheDocument();
    consoleSpy.mockRestore();
  });

  it('shows a generic message when profile fetch returns a non-401 error response', async () => {
    getMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Server error',
      data: {},
    });

    renderProfile();

    await waitFor(() => expect(getMock).toHaveBeenCalled());
    expect(await screen.findByText(/failed to load profile/i)).toBeInTheDocument();
  });

  it('renders legacy profile responses that do not include a nested profile object', async () => {
    getMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      data: {
        id: 77,
        username: 'Legacy User',
        marital_status: 'Single',
        age: 40,
        birth_date: '1985-01-01',
        occupation: 'Teacher',
        monthly_income: 9000,
        family_status: 'Single',
        location: 'Haifa',
        industry: 'Education',
        children_count: 0,
        household_size: 1,
        home_ownership: 'rent',
        education_level: 'master',
        employment_status: 'employed',
      },
    });

    renderProfile();

    expect(await screen.findByDisplayValue('Legacy User')).toBeInTheDocument();
    expect(screen.getByText(/household of 1/i)).toBeInTheDocument();
  });

  it('recalculates age when the selected birth date is still upcoming this year', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2025-03-01T12:00:00Z'));

    try {
      getMock.mockResolvedValue(baseProfileResponse);

      renderProfile();
      await screen.findByDisplayValue('Jane Doe');

      const birthDateInput = screen.getByLabelText('Birth Date');
      fireEvent.change(birthDateInput, { target: { value: '1995-03-15' } });

      expect(await screen.findByText('Age: 29')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('updates household size, spouse section, and chip when marital status toggles', async () => {
    getMock.mockResolvedValue(baseProfileResponse);

    renderProfile();
    await screen.findByDisplayValue('Jane Doe');

    const usernameField = screen.getByLabelText(/username/i);
    fireEvent.change(usernameField, { target: { value: 'Jane Updated' } });
    expect(screen.getByDisplayValue('Jane Updated')).toBeInTheDocument();

    const openMaritalMenu = async (optionText: RegExp | string) => {
      const selectRoot = screen.getByTestId('marital-status-select');
      const trigger = (selectRoot.querySelector('[role="combobox"]') ?? selectRoot) as HTMLElement;
      fireEvent.mouseDown(trigger);
      const option = await screen.findByRole('option', { name: optionText });
      fireEvent.click(option);
    };

    await openMaritalMenu(/married/i);

    expect(await screen.findByLabelText(/spouse name/i)).toBeInTheDocument();

    const spouseName = screen.getByLabelText(/spouse name/i);
    fireEvent.change(spouseName, { target: { value: 'Ari' } });

    await waitFor(() => {
      expect(screen.getByText(/household of 2/i)).toBeInTheDocument();
      expect(screen.getByText('Ari')).toBeInTheDocument();
    });

    await openMaritalMenu(/single/i);

    await waitFor(() => {
      expect(screen.queryByLabelText(/spouse name/i)).not.toBeInTheDocument();
      expect(screen.getByText(/household of 1/i)).toBeInTheDocument();
    });
  });

  it('adds a new child and updates the household summary chip', async () => {
    const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
    try {
      getMock.mockResolvedValue(baseProfileResponse);

      renderProfile();
      await screen.findByDisplayValue('Jane Doe');

      fireEvent.click(screen.getByRole('button', { name: /children information/i }));
      fireEvent.click(screen.getByRole('button', { name: /add child/i }));

      const childNameInput = await screen.findByLabelText(/child name/i);
      fireEvent.change(childNameInput, { target: { value: 'Noa' } });

      const childDialog = childNameInput.closest('[role="dialog"]') as HTMLElement | null;
      const dialogScope = childDialog ? within(childDialog) : screen;

      fireEvent.change(dialogScope.getByLabelText(/birth date/i), { target: { value: '2018-01-15' } });

      fireEvent.click(dialogScope.getByRole('button', { name: /^add child$/i }));

      await waitFor(() => expect(screen.getByText('Noa')).toBeInTheDocument());
      expect(screen.getByText(/household of 2/i)).toBeInTheDocument();
      const summaryLine = screen.getByText(/household summary/i).closest('p') ?? screen.getByText(/household summary/i);
      expect(summaryLine).toHaveTextContent(/1 child/i);
    } finally {
      dateSpy.mockRestore();
    }
  });

  it('edits and deletes an existing child, updating household totals accordingly', async () => {
    const responseWithChild = cloneBaseResponse();
    responseWithChild.data.profile.children_count = 1;
    responseWithChild.data.profile.household_size = 2;
    responseWithChild.data.children = [
      {
        id: 101,
        name: 'Kiddo',
        birth_date: '2015-05-10',
        gender: 'female',
        education_stage: 'middle_school',
        special_needs: true,
      },
    ];

    getMock.mockResolvedValue(responseWithChild);

    renderProfile();
    await screen.findByDisplayValue('Jane Doe');

    fireEvent.click(screen.getByRole('button', { name: /children information/i }));

    fireEvent.click(screen.getByLabelText(/edit child/i));

    const nameField = await screen.findByLabelText(/child name/i);
    fireEvent.change(nameField, { target: { value: 'Updated Kid' } });

    fireEvent.click(screen.getByRole('button', { name: /update child/i }));

    await waitFor(() => expect(screen.getByText('Updated Kid')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText(/delete child/i));

    await waitFor(() => {
      expect(screen.queryByText('Updated Kid')).not.toBeInTheDocument();
      expect(screen.getByText(/household of 1/i)).toBeInTheDocument();
    });
  });
});
