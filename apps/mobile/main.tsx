import React from 'react';
import { createRoot } from 'react-dom/client';
import { MobileApp } from './MobileApp';
import '../../packages/ui/styles.css';
import '../../packages/ui/navigation.css';
import '../../packages/ui/polish.css';
import './mobile.css';
import { setNativeDownload } from '../../packages/platform/storage';
import { exportMobileFile, isAndroid } from './native';

if (isAndroid)
  setNativeDownload((blob, name) => {
    void exportMobileFile(blob, name).catch((error) =>
      window.dispatchEvent(
        new CustomEvent('mobile-error', { detail: String(error.message || error) }),
      ),
    );
  });

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MobileApp />
  </React.StrictMode>,
);
