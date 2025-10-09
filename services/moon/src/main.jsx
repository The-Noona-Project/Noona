import { ChakraProvider, ColorModeScript } from '@chakra-ui/react';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import AppTheme, { themeConfig } from './theme.js';
import router from './router.jsx';
import { ServiceInstallationProvider } from './state/serviceInstallationContext.tsx';
import './style.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Failed to find the root element');
}

const root = createRoot(container);

root.render(
  <React.StrictMode>
    <ColorModeScript initialColorMode={themeConfig.initialColorMode} />
    <ChakraProvider theme={AppTheme}>
      <ServiceInstallationProvider>
        <RouterProvider router={router} />
      </ServiceInstallationProvider>
    </ChakraProvider>
  </React.StrictMode>,
);
