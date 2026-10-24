import { useEffect } from 'react';

// iOS Safari/WKWebView doesn't shrink 100vh when the software keyboard opens.
export function useMobileViewport() {
  useEffect(() => {
    const viewport = window.visualViewport;
    const update = () => {
      if (viewport && Math.abs(viewport.scale - 1) > 0.02) return;
      document.documentElement.style.setProperty(
        '--mobile-height',
        `${viewport?.height ?? innerHeight}px`,
      );
      document.documentElement.dataset.keyboardOpen = String(
        !!viewport && innerHeight - viewport.height > 120,
      );
    };
    update();
    viewport?.addEventListener('resize', update);
    window.addEventListener('resize', update);
    return () => {
      viewport?.removeEventListener('resize', update);
      window.removeEventListener('resize', update);
      document.documentElement.style.removeProperty('--mobile-height');
      delete document.documentElement.dataset.keyboardOpen;
    };
  }, []);
}
