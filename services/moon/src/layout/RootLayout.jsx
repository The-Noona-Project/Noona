import React from 'react';
import { Outlet, useMatches } from 'react-router-dom';
import Header from '../components/Header.jsx';

export default function RootLayout() {
  const matches = useMatches();
  const activeTitle = [...matches]
    .reverse()
    .find((match) => typeof match.handle?.title === 'string')?.handle.title;

  return (
    <Header title={activeTitle}>
      <Outlet />
    </Header>
  );
}
