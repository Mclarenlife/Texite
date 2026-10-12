import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../../packages/workbench/App';
import '../../packages/ui/styles.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
