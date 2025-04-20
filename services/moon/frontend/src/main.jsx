// services/moon/frontend/src/main.jsx

import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './index.css';

/**
 * Entry point for Noona-Moon frontend.
 * Mounts the <App /> component inside #root using React 19's `createRoot`.
 */
const rootElement = document.getElementById('root');
const root = createRoot(rootElement);

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
