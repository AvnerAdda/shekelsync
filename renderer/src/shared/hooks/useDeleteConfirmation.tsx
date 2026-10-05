import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from '@mui/material';
import { useTranslation } from 'react-i18next';

/** Focus after the modal transition, when its focus trap is ready. */
export function focusDeleteCancel(element: HTMLElement) {
  element.querySelector<HTMLButtonElement>('[data-delete-cancel]')?.focus();
}

/** Deletion only proceeds after an explicit choice; dismissal and unmount cancel. */
export function useDeleteConfirmation(active = true) {
  const { t } = useTranslation('translation', { keyPrefix: 'deleteConfirmation' });
  const titleId = useId();
  const descriptionId = useId();
  const [request, setRequest] = useState<{ name: string; description?: string } | null>(null);
  const pending = useRef<((confirmed: boolean) => void) | null>(null);

  const confirmDelete = useCallback((name: string, description?: string): Promise<boolean> => {
    // A second click must not replace the item the user is already reviewing.
    if (pending.current) return Promise.resolve(false);
    return new Promise(resolve => {
      pending.current = resolve;
      setRequest({ name, description });
    });
  }, []);

  const settle = (confirmed: boolean) => {
    const resolve = pending.current;
    pending.current = null;
    setRequest(null);
    resolve?.(confirmed);
  };

  useEffect(() => () => {
    pending.current?.(false);
    pending.current = null;
  }, []);

  useEffect(() => {
    if (active) return;
    pending.current?.(false);
    pending.current = null;
    setRequest(null);
  }, [active]);

  const deleteConfirmationDialog = request ? (
    <Dialog
      open
      onClose={() => settle(false)}
      maxWidth="xs"
      fullWidth
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      slotProps={{ transition: { onEntered: focusDeleteCancel } }}
      sx={{ zIndex: theme => theme.zIndex.modal + 10 }}
    >
      <DialogTitle id={titleId}>{t('title', { name: request.name })}</DialogTitle>
      <DialogContent>
        <DialogContentText id={descriptionId}>
          {request.description || t('message')}
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button autoFocus data-delete-cancel onClick={() => settle(false)}>{t('cancel')}</Button>
        <Button color="error" variant="contained" onClick={() => settle(true)}>{t('delete')}</Button>
      </DialogActions>
    </Dialog>
  ) : null;

  return { confirmDelete, deleteConfirmationDialog };
}
