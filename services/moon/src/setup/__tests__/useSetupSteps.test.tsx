import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSetupSteps } from '../useSetupSteps.ts';
import * as api from '../api.ts';
import * as serviceInstallation from '../../state/serviceInstallationContext.tsx';
import * as wizardStateHook from '../useWizardState.ts';
import type { ServiceEntry } from '../../utils/serviceStatus.ts';

vi.mock('../api.ts', () => ({
  createPortalDiscordChannel: vi.fn(),
  createPortalDiscordRole: vi.fn(),
  fetchInstallProgress: vi.fn(),
  fetchServiceHealth: vi.fn(),
  installServices: vi.fn(),
  detectRavenMount: vi.fn(),
  validatePortalDiscordConfig: vi.fn(),
  fetchVerificationStatus: vi.fn(),
  runVerificationChecks: vi.fn(),
  completeWizardSetup: vi.fn(),
  fetchWizardMetadata: vi.fn(),
}));

vi.mock('../../state/serviceInstallationContext.tsx', () => ({
  useServiceInstallation: vi.fn(),
}));

vi.mock('../useWizardState.ts', () => ({
  useWizardState: vi.fn(),
}));

const defaultWizardState = {
  version: 2,
  updatedAt: null,
  completed: false,
  foundation: {
    status: 'pending' as const,
    detail: null,
    error: null,
    updatedAt: null,
    completedAt: null,
    actor: null,
    retries: 0,
    timeline: [],
  },
  portal: {
    status: 'pending' as const,
    detail: null,
    error: null,
    updatedAt: null,
    completedAt: null,
    actor: null,
    retries: 0,
    timeline: [],
  },
  raven: {
    status: 'pending' as const,
    detail: null,
    error: null,
    updatedAt: null,
    completedAt: null,
    actor: null,
    retries: 0,
    timeline: [],
  },
  verification: {
    status: 'pending' as const,
    detail: null,
    error: null,
    updatedAt: null,
    completedAt: null,
    actor: null,
    retries: 0,
    timeline: [],
  },
};

const mockServices: ServiceEntry[] = [
  { name: 'noona-vault', envConfig: [] },
  { name: 'noona-redis', envConfig: [] },
  { name: 'noona-mongo', envConfig: [] },
  { name: 'noona-portal', envConfig: [] },
  { name: 'noona-raven', envConfig: [] },
];

describe('useSetupSteps', () => {
  let warnSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    warnSpy?.mockRestore();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    vi.mocked(api.fetchWizardMetadata).mockRejectedValue(new Error('unreachable'));
    vi.mocked(api.fetchInstallProgress).mockResolvedValue({ status: 'idle', percent: null, items: [] });
    vi.mocked(api.fetchServiceHealth).mockResolvedValue({ status: 'healthy' });
    vi.mocked(api.installServices).mockResolvedValue({ results: [] });
    vi.mocked(api.detectRavenMount).mockResolvedValue({ detection: { mountPath: null } });
    vi.mocked(api.validatePortalDiscordConfig).mockResolvedValue({ valid: true } as never);
    vi.mocked(api.fetchVerificationStatus).mockResolvedValue({
      wizard: defaultWizardState,
      summary: null,
      health: { warden: null, sage: null },
    });
    vi.mocked(api.runVerificationChecks).mockResolvedValue({
      summary: null,
      health: { warden: null, sage: null },
    });
    vi.mocked(api.completeWizardSetup).mockResolvedValue({
      wizard: defaultWizardState,
      summary: null,
      health: { warden: null, sage: null },
    });

    vi.mocked(serviceInstallation.useServiceInstallation).mockReturnValue({
      services: mockServices,
      loading: false,
      error: '',
      navigationItems: [],
      hasPendingSetup: true,
      wizardState: defaultWizardState,
      wizardLoading: false,
      wizardError: '',
      ensureLoaded: vi.fn().mockResolvedValue(mockServices),
      refresh: vi.fn().mockResolvedValue(mockServices),
      refreshWizard: vi.fn().mockResolvedValue(defaultWizardState),
      isServiceInstalled: vi.fn().mockReturnValue(false),
    });

    vi.mocked(wizardStateHook.useWizardState).mockReturnValue({
      state: defaultWizardState,
      loading: false,
      error: null,
      refresh: vi.fn().mockResolvedValue(defaultWizardState),
      update: vi.fn().mockResolvedValue(defaultWizardState),
    });
  });

  afterEach(() => {
    warnSpy?.mockRestore();
    warnSpy = null;
  });

  it('falls back to default step definitions when metadata cannot be loaded', async () => {
    const { result } = renderHook(() => useSetupSteps());

    await waitFor(() => expect(api.fetchWizardMetadata).toHaveBeenCalled());
    await waitFor(() => expect(result.current.steps.length).toBeGreaterThan(0));

    expect(result.current.steps.map((step) => step.id)).toEqual([
      'foundation',
      'portal',
      'raven',
      'verification',
    ]);
  });
});
