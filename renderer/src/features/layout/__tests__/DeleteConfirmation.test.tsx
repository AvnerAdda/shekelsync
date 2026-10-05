import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { useDeleteConfirmation } from '@renderer/shared/hooks/useDeleteConfirmation';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { name?: string }) => ({
      title: `Delete “${options?.name}”?`, message: 'This action cannot be undone.',
      cancel: 'Cancel', delete: 'Delete',
    })[key],
  }),
}));

function Harness({ onDecision, active = true }: { onDecision: (confirmed: boolean) => void; active?: boolean }) {
  const { confirmDelete, deleteConfirmationDialog } = useDeleteConfirmation(active);
  return <>
    <button onClick={() => void confirmDelete('Groceries').then(onDecision)}>Remove category</button>
    <button onClick={() => void confirmDelete('Rent').then(onDecision)}>Remove another</button>
    {deleteConfirmationDialog}
  </>;
}

describe('delete confirmation', () => {
  it('shows the exact item and defaults Enter to Cancel', async () => {
    const onDecision = vi.fn();
    const user = userEvent.setup();
    render(<Harness onDecision={onDecision} />);
    await user.click(screen.getByRole('button', { name: 'Remove category' }));
    expect(screen.getByRole('dialog', { name: 'Delete “Groceries”?' })).toBeInTheDocument();
    expect(onDecision).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onDecision).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('only permits deletion after clicking Delete', async () => {
    const onDecision = vi.fn();
    const user = userEvent.setup();
    render(<Harness onDecision={onDecision} />);
    await user.click(screen.getByRole('button', { name: 'Remove category' }));
    await user.click(screen.getByRole('button', { name: 'Delete', exact: true }));
    expect(onDecision).toHaveBeenCalledExactlyOnceWith(true);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it.each(['escape', 'backdrop', 'cancel'])('cancels on %s without granting deletion', async method => {
    const onDecision = vi.fn();
    const user = userEvent.setup();
    render(<Harness onDecision={onDecision} />);
    await user.click(screen.getByRole('button', { name: 'Remove category' }));
    if (method === 'escape') await user.keyboard('{Escape}');
    else if (method === 'cancel') await user.click(screen.getByRole('button', { name: 'Cancel' }));
    else {
      const backdropTarget = screen.getByRole('dialog').parentElement!;
      fireEvent.mouseDown(backdropTarget);
      fireEvent.click(backdropTarget);
    }
    await waitFor(() => expect(onDecision).toHaveBeenCalledExactlyOnceWith(false));
  });

  it('cancels an outstanding request if its owner unmounts', async () => {
    const onDecision = vi.fn();
    const user = userEvent.setup();
    const { unmount } = render(<Harness onDecision={onDecision} />);
    await user.click(screen.getByRole('button', { name: 'Remove category' }));
    await act(async () => unmount());
    expect(onDecision).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('cancels when the parent modal closes and does not revive the request on reopen', async () => {
    const onDecision = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<Harness onDecision={onDecision} />);
    await user.click(screen.getByRole('button', { name: 'Remove category' }));
    rerender(<Harness onDecision={onDecision} active={false} />);
    await waitFor(() => expect(onDecision).toHaveBeenCalledExactlyOnceWith(false));
    rerender(<Harness onDecision={onDecision} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not replace the item awaiting confirmation on repeated requests', async () => {
    const onDecision = vi.fn();
    const user = userEvent.setup();
    render(<Harness onDecision={onDecision} />);
    const other = screen.getByRole('button', { name: 'Remove another' });
    await user.click(screen.getByRole('button', { name: 'Remove category' }));
    fireEvent.click(other);
    await waitFor(() => expect(onDecision).toHaveBeenCalledExactlyOnceWith(false));
    expect(screen.getByRole('dialog', { name: 'Delete “Groceries”?' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Delete', exact: true }));
    expect(onDecision.mock.calls).toEqual([[false], [true]]);
  });
});
