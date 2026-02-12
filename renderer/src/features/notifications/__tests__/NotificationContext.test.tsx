import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NotificationProvider, useNotification } from '../NotificationContext';

describe('NotificationContext', () => {
  it('throws when useNotification is called outside the provider', () => {
    const ThrowingConsumer = () => {
      useNotification();
      return null;
    };

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<ThrowingConsumer />)).toThrow('useNotification must be used within a NotificationProvider');
    consoleError.mockRestore();
  });

  it('shows notification text when invoked from provider consumer', () => {
    const Consumer = () => {
      const { showNotification } = useNotification();
      return (
        <button onClick={() => showNotification('Operation completed', 'success')}>
          trigger-success
        </button>
      );
    };

    render(
      <NotificationProvider>
        <Consumer />
      </NotificationProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'trigger-success' }));

    expect(screen.getByText('Operation completed')).toBeInTheDocument();
  });

  it('updates the snackbar message on consecutive notifications', () => {
    const Consumer = () => {
      const { showNotification } = useNotification();
      return (
        <>
          <button onClick={() => showNotification('First message', 'warning')}>first</button>
          <button onClick={() => showNotification('Second message', 'error')}>second</button>
        </>
      );
    };

    render(
      <NotificationProvider>
        <Consumer />
      </NotificationProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'first' }));
    expect(screen.getByText('First message')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'second' }));
    expect(screen.getByText('Second message')).toBeInTheDocument();
  });
});
