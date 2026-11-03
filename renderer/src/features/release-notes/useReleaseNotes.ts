import { useCallback, useEffect, useRef, useState } from 'react';
import { version } from '@app/package.json';
import { onStartupReady } from '@renderer/app/startup/startup-readiness';
import { OPEN_RELEASE_NOTES_EVENT } from './constants';

export function useReleaseNotes({ suppressed = false }: { suppressed?: boolean } = {}) {
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const acknowledged = useRef(false);
  const openedManually = useRef(false);

  useEffect(() => {
    let active = true;
    const unsubscribe = onStartupReady(() => {
      void (async () => {
        try {
          const result = await window.electronAPI?.settings?.get?.();
          if (active && !acknowledged.current && !openedManually.current && result?.success) {
            setPending(result.settings?.lastSeenReleaseVersion !== version);
          }
        } catch {
          // A release announcement must never block startup or navigation.
        } finally {
          if (active) setLoading(false);
        }
      })();
    });
    const openManually = () => {
      openedManually.current = true;
      setPending(true);
    };
    window.addEventListener(OPEN_RELEASE_NOTES_EVENT, openManually);

    return () => {
      active = false;
      unsubscribe();
      window.removeEventListener(OPEN_RELEASE_NOTES_EVENT, openManually);
    };
  }, []);

  const dismiss = useCallback(() => {
    acknowledged.current = true;
    setPending(false);
    // Persist outside renderer storage so installer and origin changes do not
    // repeat the announcement. If persistence fails, retry on the next launch.
    const settings = window.electronAPI?.settings;
    if (!settings?.update) return;
    setSaving(true);
    void (async () => {
      try {
        await settings.update?.({ lastSeenReleaseVersion: version });
      } catch {
        // The dialog remains dismissible even when settings are unavailable.
      } finally {
        setSaving(false);
      }
    })();
  }, []);

  return { open: pending && !suppressed, pending: loading || pending || saving, dismiss };
}
