import { useState, useEffect, useCallback } from 'react';

interface UseAsyncState<T> {
  data: T | null;
  error: Error | null;
  isLoading: boolean;
  isError: boolean;
  isSuccess: boolean;
}

interface UseAsyncOptions<T> {
  immediate?: boolean;
  onSuccess?: (data: T) => void;
  onError?: (error: Error) => void;
  initialData?: T | null;
}

/**
 * Hook for managing async operations with loading, error, and success states
 *
 * @example
 * ```tsx
 * const { data, isLoading, error, execute } = useAsync(
 *   async () => fetch('/api/data').then(r => r.json()),
 *   { immediate: true }
 * );
 *
 * if (isLoading) return <LoadingState />;
 * if (error) return <ErrorMessage error={error} />;
 * return <DataDisplay data={data} />;
 * ```
 */
export function useAsync<T>(
  asyncFunction: () => Promise<T>,
  options: UseAsyncOptions<T> = {}
): UseAsyncState<T> & { execute: () => Promise<void>; reset: () => void } {
  const { immediate = false, onSuccess, onError, initialData = null } = options;

  const [state, setState] = useState<UseAsyncState<T>>({
    data: initialData,
    error: null,
    isLoading: false,
    isError: false,
    isSuccess: false,
  });

  const execute = useCallback(async () => {
    setState((prev) => ({
      ...prev,
      isLoading: true,
      isError: false,
      error: null,
    }));

    try {
      const data = await asyncFunction();
      setState({
        data,
        error: null,
        isLoading: false,
        isError: false,
        isSuccess: true,
      });
      onSuccess?.(data);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      setState({
        data: null,
        error: err,
        isLoading: false,
        isError: true,
        isSuccess: false,
      });
      onError?.(err);
    }
  }, [asyncFunction, onSuccess, onError]);

  const reset = useCallback(() => {
    setState({
      data: initialData,
      error: null,
      isLoading: false,
      isError: false,
      isSuccess: false,
    });
  }, [initialData]);

  useEffect(() => {
    if (immediate) {
      execute();
    }
  }, [immediate]); // Only run on mount if immediate is true

  return {
    ...state,
    execute,
    reset,
  };
}

export default useAsync;
