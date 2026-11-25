import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import OneZeroVerificationDialog from '../OneZeroVerificationDialog';

const { postMock } = vi.hoisted(() => ({ postMock: vi.fn() }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => (options ? `${key} ${JSON.stringify(options)}` : key),
    i18n: { language: 'en' },
  }),
}));

vi.mock('@/lib/api-client', () => ({
  apiClient: { post: (...args: unknown[]) => postMock(...args) },
}));

function renderDialog(overrides: Partial<React.ComponentProps<typeof OneZeroVerificationDialog>> = {}) {
  const props = {
    open: true,
    credentialId: 7,
    accountLabel: 'One Zero main',
    onClose: vi.fn(),
    onVerified: vi.fn(),
    ...overrides,
  };
  render(<OneZeroVerificationDialog {...props} />);
  return props;
}

describe('OneZeroVerificationDialog', () => {
  beforeEach(() => {
    postMock.mockReset();
  });

  it('sends the code, then verifies it', async () => {
    postMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: { sessionId: 'session-1', expiresAt: '2026-01-15T10:10:00.000Z', maskedPhoneNumber: '•••• 4567' },
      })
      .mockResolvedValueOnce({ ok: true, status: 200, data: { verified: true } });
    const props = renderDialog();

    fireEvent.change(screen.getByTestId('one-zero-phone'), { target: { value: '050-1234567' } });
    fireEvent.click(screen.getByRole('button', { name: 'actions.sendCode' }));

    await screen.findByTestId('one-zero-code');
    expect(postMock).toHaveBeenCalledWith('/api/credentials/7/one-zero/verification', { phoneNumber: '050-1234567' });
    expect(screen.getByText(/codeSentTo/)).toHaveTextContent('•••• 4567');

    fireEvent.change(screen.getByTestId('one-zero-code'), { target: { value: '12a3456' } });
    expect(screen.getByTestId('one-zero-code')).toHaveValue('123456');
    fireEvent.click(screen.getByRole('button', { name: 'actions.verify' }));

    await waitFor(() => expect(props.onVerified).toHaveBeenCalledTimes(1));
    expect(postMock).toHaveBeenLastCalledWith('/api/credentials/7/one-zero/verification/confirm', {
      sessionId: 'session-1',
      code: '123456',
    });
  });

  it('shows the remaining attempts when a code is rejected and stays on the code step', async () => {
    postMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: { sessionId: 'session-1', expiresAt: '2026-01-15T10:10:00.000Z', maskedPhoneNumber: '•••• 4567' },
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        data: { error: 'One Zero did not accept that code', code: 'code_rejected', attemptsRemaining: 2 },
      });
    const props = renderDialog();

    fireEvent.change(screen.getByTestId('one-zero-phone'), { target: { value: '0501234567' } });
    fireEvent.click(screen.getByRole('button', { name: 'actions.sendCode' }));
    fireEvent.change(await screen.findByTestId('one-zero-code'), { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'actions.verify' }));

    expect(await screen.findByText('errors.code_rejected {"count":2}')).toBeInTheDocument();
    expect(screen.getByTestId('one-zero-code')).toBeInTheDocument();
    expect(props.onVerified).not.toHaveBeenCalled();
  });

  it('goes back to the phone step when the code request expired', async () => {
    postMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: { sessionId: 'session-1', expiresAt: '2026-01-15T10:10:00.000Z', maskedPhoneNumber: '•••• 4567' },
      })
      .mockResolvedValueOnce({ ok: false, status: 410, data: { code: 'session_expired' } });
    renderDialog();

    fireEvent.change(screen.getByTestId('one-zero-phone'), { target: { value: '0501234567' } });
    fireEvent.click(screen.getByRole('button', { name: 'actions.sendCode' }));
    fireEvent.change(await screen.findByTestId('one-zero-code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'actions.verify' }));

    expect(await screen.findByText('errors.session_expired {"count":0}')).toBeInTheDocument();
    expect(screen.getByTestId('one-zero-phone')).toBeInTheDocument();
  });

  it('falls back to a generic message for unknown errors', async () => {
    postMock.mockResolvedValueOnce({ ok: false, status: 401, data: { error: 'REAUTH_REQUIRED' } });
    renderDialog();

    fireEvent.change(screen.getByTestId('one-zero-phone'), { target: { value: '0501234567' } });
    fireEvent.click(screen.getByRole('button', { name: 'actions.sendCode' }));

    expect(await screen.findByText('errors.generic')).toBeInTheDocument();
  });
});
