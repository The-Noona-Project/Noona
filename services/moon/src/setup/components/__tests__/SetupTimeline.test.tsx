import React from 'react';
import { screen } from '@testing-library/react';
import SetupTimeline from '../SetupTimeline.tsx';
import { createMockWizardState, renderWithProviders } from '../../../test/testUtils.tsx';

describe('SetupTimeline', () => {
  it('renders timeline metadata and retry counts', () => {
    const baseWizard = createMockWizardState();
    const wizardState = createMockWizardState({
      foundation: {
        ...baseWizard.foundation,
        timeline: [
          {
            id: 'evt-1',
            timestamp: '2024-01-01T00:00:00.000Z',
            status: 'info',
            message: 'Awaiting credentials',
            detail: 'Waiting for admin confirmation',
            code: 'awaiting-creds',
            actor: { id: 'moon', type: 'ui', label: 'Moon UI', avatarUrl: null, metadata: null },
            context: null,
          },
        ],
        retries: 2,
      },
    });

    renderWithProviders(
      <SetupTimeline
        foundationServices={[]}
        additionalServices={[]}
        wizardSteps={[{ key: 'foundation', label: 'Foundation', state: wizardState.foundation }]}
        wizardState={wizardState}
        wizardLoading={false}
        wizardError={null}
        onRefresh={() => {}}
      />,
      { wizardState },
    );

    expect(screen.getByTestId('wizard-step-foundation-timeline')).toHaveTextContent('Awaiting credentials');
    expect(screen.getByTestId('wizard-step-foundation-retries')).toHaveTextContent('Retried 2 times');
  });
});
