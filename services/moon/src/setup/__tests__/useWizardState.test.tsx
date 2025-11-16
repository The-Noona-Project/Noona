import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useWizardState } from '../useWizardState.ts';
import * as api from '../api.ts';

vi.mock('../api.ts', () => ({
  fetchWizardState: vi.fn(),
  updateWizardState: vi.fn(),
}));

const defaultWizardState = {
  version: 1,
  updatedAt: null,
  completed: false,
  foundation: {
    status: 'pending',
    detail: null,
    error: null,
    updatedAt: null,
    completedAt: null,
    actor: null,
    retries: 0,
    timeline: [],
  },
  portal: {
    status: 'pending',
    detail: null,
    error: null,
    updatedAt: null,
    completedAt: null,
    actor: null,
    retries: 0,
    timeline: [],
  },
  raven: {
    status: 'pending',
    detail: null,
    error: null,
    updatedAt: null,
    completedAt: null,
    actor: null,
    retries: 0,
    timeline: [],
  },
  verification: {
    status: 'pending',
    detail: null,
    error: null,
    updatedAt: null,
    completedAt: null,
    actor: null,
    retries: 0,
    timeline: [],
  },
};

describe('useWizardState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.fetchWizardState).mockResolvedValue(defaultWizardState);
    vi.mocked(api.updateWizardState).mockResolvedValue(defaultWizardState);
  });

  it('loads wizard state on mount', async () => {
    const { result } = renderHook(() => useWizardState());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(api.fetchWizardState).toHaveBeenCalled();
    expect(result.current.state).toEqual(defaultWizardState);
    expect(result.current.error).toBeNull();
  });

  it('updates wizard state through the update helper', async () => {
    const updatedState = {
      ...defaultWizardState,
      foundation: { ...defaultWizardState.foundation, status: 'complete' as const },
    };
    vi.mocked(api.updateWizardState).mockResolvedValueOnce(updatedState);

    const { result } = renderHook(() => useWizardState());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await result.current.update({ step: 'foundation', status: 'complete' });

    expect(api.updateWizardState).toHaveBeenCalledWith({ step: 'foundation', status: 'complete' });
    await waitFor(() => expect(result.current.state).toEqual(updatedState));
    expect(result.current.error).toBeNull();
  });

  it('captures load errors and exposes message', async () => {
    vi.mocked(api.fetchWizardState).mockRejectedValueOnce(new Error('vault offline'));

    const { result } = renderHook(() => useWizardState());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('vault offline');
  });
});
