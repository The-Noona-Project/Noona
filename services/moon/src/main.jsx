import React from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { Modal } from '@textkernel/oneui';
import { OneUIProvider } from './theme/index.jsx';
import router from './router.jsx';
import { ServiceInstallationProvider } from './state/serviceInstallationContext.tsx';
import '@textkernel/oneui/dist/oneui.min.css';
import './style.css';

if (typeof document !== 'undefined') {
  Modal.setAppElement?.('#root');
}

const container = document.getElementById('root');
if (!container) {
  throw new Error('Failed to find the root element');
}

const root = createRoot(container);

root.render(
  <React.StrictMode>
    <OneUIProvider>
      <ServiceInstallationProvider>
        <RouterProvider router={router} />
      </ServiceInstallationProvider>
    </OneUIProvider>
  </React.StrictMode>,
);
