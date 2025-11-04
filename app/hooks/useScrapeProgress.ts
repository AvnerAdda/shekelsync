import { useEffect, useRef, useState } from 'react';

export type ScrapeProgressStatus = 'starting' | 'in_progress' | 'completed' | 'failed';

export interface ScrapeProgressEvent {
  vendor?: string;
  status: ScrapeProgressStatus;
  progress?: number;
  message?: string;
  transactions?: number;
  error?: string;
}

interface ScrapeProgressState {
  latestEvent: ScrapeProgressEvent | null;
  isRunning: boolean;
  lastCompletedAt: Date | null;
}

const isRenderer = typeof window !== 'undefined';

function subscribeToElectronScrapeProgress(
  handler: (event: ScrapeProgressEvent) => void,
): (() => void) | undefined {
  if (!isRenderer) {
    return undefined;
  }

  const eventsApi = window.electronAPI?.events;
  if (eventsApi?.onScrapeProgress) {
    const unsubscribe = eventsApi.onScrapeProgress(rawEvent => {
      const allowedStatuses: ScrapeProgressStatus[] = ['starting', 'in_progress', 'completed', 'failed'];
      const status = allowedStatuses.includes(rawEvent.status as ScrapeProgressStatus)
        ? (rawEvent.status as ScrapeProgressStatus)
        : 'in_progress';

      handler({
        vendor: rawEvent.vendor,
        status,
        progress: typeof rawEvent.progress === 'number' ? rawEvent.progress : undefined,
        message: rawEvent.message,
        transactions: typeof rawEvent.transactions === 'number' ? rawEvent.transactions : undefined,
        error: rawEvent.error,
      });
    });
    return typeof unsubscribe === 'function' ? unsubscribe : undefined;
  }

  return undefined;
}

function subscribeToFallbackScrapeEvent(
  handler: (event: ScrapeProgressEvent) => void,
): (() => void) | undefined {
  if (!isRenderer || typeof window.addEventListener !== 'function') {
    return undefined;
  }

  const fallbackHandler = (event: Event) => {
    const customEvent = event as CustomEvent<Partial<ScrapeProgressEvent>>;
    const detail = customEvent.detail;
    if (!detail) {
      return;
    }

    const allowedStatuses: ScrapeProgressStatus[] = ['starting', 'in_progress', 'completed', 'failed'];
    const status = allowedStatuses.includes(detail.status as ScrapeProgressStatus)
      ? (detail.status as ScrapeProgressStatus)
      : 'in_progress';

    handler({
      vendor: detail.vendor,
      status,
      progress: typeof detail.progress === 'number' ? detail.progress : undefined,
      message: detail.message,
      transactions: typeof detail.transactions === 'number' ? detail.transactions : undefined,
      error: detail.error,
    });
  };

  window.addEventListener('scrapeProgress', fallbackHandler);

  return () => {
    window.removeEventListener('scrapeProgress', fallbackHandler);
  };
}

export function useScrapeProgress(onEvent?: (event: ScrapeProgressEvent) => void): ScrapeProgressState {
  const [latestEvent, setLatestEvent] = useState<ScrapeProgressEvent | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [lastCompletedAt, setLastCompletedAt] = useState<Date | null>(null);
  const handlerRef = useRef(onEvent);

  useEffect(() => {
    handlerRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    const listener = (payload: ScrapeProgressEvent) => {
      setLatestEvent(payload);

      if (payload.status === 'completed') {
        setIsRunning(false);
        setLastCompletedAt(new Date());
      } else if (payload.status === 'failed') {
        setIsRunning(false);
      } else {
        setIsRunning(true);
      }

      handlerRef.current?.(payload);
    };

    const unsubscribeElectron = subscribeToElectronScrapeProgress(listener);
    if (unsubscribeElectron) {
      return () => {
        unsubscribeElectron();
      };
    }

    const unsubscribeFallback = subscribeToFallbackScrapeEvent(listener);
    return () => {
      unsubscribeFallback?.();
    };
  }, []);

  return {
    latestEvent,
    isRunning,
    lastCompletedAt,
  };
}
