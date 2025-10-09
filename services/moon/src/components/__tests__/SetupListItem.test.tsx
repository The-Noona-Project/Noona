import { fireEvent, screen } from '@testing-library/react';
import React from 'react';
import { vi } from 'vitest';
import SetupListItem from '../../components/SetupListItem.jsx';
import { renderWithProviders } from '../../test/testUtils.tsx';

describe('SetupListItem', () => {
  it('invokes the toggle handler when clicked', () => {
    const handleToggle = vi.fn();

    renderWithProviders(
      <SetupListItem
        service={{ name: 'noona-raven', category: 'addon', description: 'Raven service' }}
        selected={false}
        onToggle={handleToggle}
      />,
    );

    const [listItem] = screen.getAllByRole('checkbox', { name: /noona-raven/i });
    fireEvent.click(listItem);

    expect(handleToggle).toHaveBeenCalledWith('noona-raven');
  });

  it('disables interaction when the service is required', () => {
    const handleToggle = vi.fn();

    renderWithProviders(
      <SetupListItem
        service={{ name: 'noona-warden', category: 'core', required: true }}
        selected={true}
        onToggle={handleToggle}
      />,
    );

    const [checkbox] = screen.getAllByRole('checkbox', { name: /noona-warden/i });
    fireEvent.click(checkbox);

    expect(handleToggle).not.toHaveBeenCalled();
  });
});
