import React, { useEffect, useState } from 'react';
import { Box, Spinner } from '@chakra-ui/react';
import { Navigate, createBrowserRouter, useLocation } from 'react-router-dom';
import RootLayout from './layout/RootLayout.jsx';
import HomePage from './pages/Home.jsx';
import MoonServicePage from './pages/MoonService.jsx';
import OraclePage from './pages/Oracle.jsx';
import PortalPage from './pages/Portal.jsx';
import RavenPage from './pages/Raven.jsx';
import SagePage from './pages/Sage.jsx';
import SetupPage from './pages/Setup.tsx';
import VaultPage from './pages/Vault.jsx';
import WardenPage from './pages/Warden.jsx';
import { useServiceInstallation } from './state/serviceInstallationContext.tsx';

function ServiceRouteGuard({ requiredService, children }) {
  const location = useLocation();
  const { ensureLoaded, isServiceInstalled, loading } = useServiceInstallation();
  const [checked, setChecked] = useState(false);
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (!requiredService) {
      setAllowed(true);
      setChecked(true);
      return () => {
        cancelled = true;
      };
    }

    ensureLoaded()
      .then(() => {
        if (cancelled) {
          return;
        }
        setAllowed(isServiceInstalled(requiredService));
        setChecked(true);
      })
      .catch(() => {
        if (!cancelled) {
          setAllowed(true);
          setChecked(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [ensureLoaded, isServiceInstalled, requiredService]);

  if (!requiredService) {
    return children;
  }

  if (loading || !checked) {
    return (
      <Box py={16} textAlign="center">
        <Spinner size="lg" />
      </Box>
    );
  }

  if (!allowed) {
    return <Navigate to="/setup" replace state={{ from: location.pathname }} />;
  }

  return children;
}

function SetupRouteGuard({ children }) {
  const location = useLocation();
  const { ensureLoaded, hasPendingSetup, loading, wizardLoading } = useServiceInstallation();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;

    ensureLoaded()
      .then(() => {
        if (!cancelled) {
          setChecked(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setChecked(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [ensureLoaded]);

  if (loading || wizardLoading || !checked) {
    return (
      <Box py={16} textAlign="center">
        <Spinner size="lg" />
      </Box>
    );
  }

  if (!hasPendingSetup) {
    return <Navigate to="/" replace state={{ from: location.pathname }} />;
  }

  return children;
}

const router = createBrowserRouter([
  {
    path: '/',
    element: <RootLayout />,
    children: [
      {
        index: true,
        element: <HomePage />,
        handle: { title: 'Home' },
      },
      {
        path: 'setup',
        element: (
          <SetupRouteGuard>
            <SetupPage />
          </SetupRouteGuard>
        ),
        handle: { title: 'Setup' },
      },
      {
        path: 'warden',
        element: (
          <ServiceRouteGuard requiredService="noona-warden">
            <WardenPage />
          </ServiceRouteGuard>
        ),
        handle: { title: 'Warden', requiredService: 'noona-warden' },
      },
      {
        path: 'vault',
        element: (
          <ServiceRouteGuard requiredService="noona-vault">
            <VaultPage />
          </ServiceRouteGuard>
        ),
        handle: { title: 'Vault', requiredService: 'noona-vault' },
      },
      {
        path: 'portal',
        element: (
          <ServiceRouteGuard requiredService="noona-portal">
            <PortalPage />
          </ServiceRouteGuard>
        ),
        handle: { title: 'Portal', requiredService: 'noona-portal' },
      },
      {
        path: 'sage',
        element: (
          <ServiceRouteGuard requiredService="noona-sage">
            <SagePage />
          </ServiceRouteGuard>
        ),
        handle: { title: 'Sage', requiredService: 'noona-sage' },
      },
      {
        path: 'moon-service',
        element: (
          <ServiceRouteGuard requiredService="noona-moon">
            <MoonServicePage />
          </ServiceRouteGuard>
        ),
        handle: { title: 'Moon Service', requiredService: 'noona-moon' },
      },
      {
        path: 'raven',
        element: (
          <ServiceRouteGuard requiredService="noona-raven">
            <RavenPage />
          </ServiceRouteGuard>
        ),
        handle: { title: 'Raven', requiredService: 'noona-raven' },
      },
      {
        path: 'oracle',
        element: (
          <ServiceRouteGuard requiredService="noona-oracle">
            <OraclePage />
          </ServiceRouteGuard>
        ),
        handle: { title: 'Oracle', requiredService: 'noona-oracle' },
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);

export default router;
