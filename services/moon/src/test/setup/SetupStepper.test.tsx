import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../testUtils.tsx';
import SetupStepper from '../../setup/components/SetupStepper.tsx';
import type { SetupStepDefinition } from '../../setup/useSetupSteps.ts';

describe('SetupStepper', () => {
  const steps: SetupStepDefinition[] = [
    {
      id: 'select',
      title: 'Select services',
      description: 'Pick which services to include in the installation.',
      status: 'complete',
    },
    {
      id: 'configure',
      title: 'Configure environment',
      description: 'Provide the required environment variables.',
      status: 'current',
    },
    {
      id: 'discord',
      title: 'Discord integration',
      description: 'Validate credentials to continue.',
      optional: true,
      status: 'upcoming',
    },
    {
      id: 'install',
      title: 'Install services',
      description: 'Review logs while we install everything for you.',
      status: 'error',
      error: 'One or more services failed to install.',
    },
  ];

  it('marks the current step and surfaces errors accessibly', () => {
    const { getByTestId, getByText } = renderWithProviders(
      <SetupStepper steps={steps} currentStepId="configure" onSelect={() => {}} />,
    );

    const currentStep = getByTestId('setup-step-configure');
    expect(currentStep).toHaveAttribute('aria-current', 'step');

    const errorStep = getByTestId('setup-step-install');
    const describedBy = errorStep.getAttribute('aria-describedby') ?? '';
    expect(describedBy).toContain('setup-step-install-description');
    expect(describedBy).toContain('setup-step-install-error');

    expect(getByText('Step 2 of 4')).toBeInTheDocument();
    expect(getByText(/1 step needs attention/)).toBeInTheDocument();
  });

  it('allows navigating to other steps via selection', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    const { getByTestId } = renderWithProviders(
      <SetupStepper steps={steps} currentStepId="configure" onSelect={onSelect} />,
    );

    await user.click(getByTestId('setup-step-select'));
    expect(onSelect).toHaveBeenCalledWith('select');
  });
});
