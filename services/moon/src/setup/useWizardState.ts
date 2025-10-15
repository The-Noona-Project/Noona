import { useCallback, useEffect, useState } from 'react';
import {
  fetchWizardState,
  updateWizardState,
  type WizardState,
  type WizardStateUpdate,
} from './api.ts';

export interface UseWizardStateOptions {
  autoLoad?: boolean;
}

export interface UseWizardStateResult {
  state: WizardState | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  update: (updates: WizardStateUpdate | WizardStateUpdate[]) => Promise<WizardState>;
}

const normalizeError = (error: unknown): string => {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === 'string' && error.trim()) {
    return error.trim();
  }

  return 'Unexpected error while updating wizard state.';
};

export function useWizardState(options: UseWizardStateOptions = {}): UseWizardStateResult {
  const { autoLoad = true } = options;
  const [state, setState] = useState<WizardState | null>(null);
  const [loading, setLoading] = useState<boolean>(autoLoad);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await fetchWizardState();
      setState(next);
      setError(null);
    } catch (err) {
      setError(normalizeError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const update = useCallback(
    async (updates: WizardStateUpdate | WizardStateUpdate[]) => {
      setLoading(true);
      try {
        const next = await updateWizardState(updates);
        setState(next);
        setError(null);
        return next;
      } catch (err) {
        const message = normalizeError(err);
        setError(message);
        throw err instanceof Error ? err : new Error(message);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!autoLoad) {
      return;
    }

    void refresh();
  }, [autoLoad, refresh]);

  return { state, loading, error, refresh, update };
}

export default useWizardState;
