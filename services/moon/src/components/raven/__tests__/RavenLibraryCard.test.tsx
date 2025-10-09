import { screen } from '@testing-library/react';
import React from 'react';
import RavenLibraryCard from '../RavenLibraryCard.jsx';
import { renderWithProviders } from '../../../test/testUtils.tsx';

describe('RavenLibraryCard', () => {
  it('renders progress information when available', () => {
    renderWithProviders(
      <RavenLibraryCard
        item={{ title: 'Test Series', description: 'A description' }}
        status={{ state: 'downloading', progress: 45, message: 'Downloading content' }}
      />,
    );

    expect(screen.getByTestId('download-progress')).toBeInTheDocument();
    expect(screen.getByText(/Downloading content/i)).toBeInTheDocument();
  });
});
