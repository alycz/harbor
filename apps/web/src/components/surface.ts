import { useLayoutEffect } from 'react';

/**
 * Marks <html> with the app's look while a page is mounted, so the tokens in styles/workspace.css also
 * reach popovers, dialogs and sheets that portal to <body>.
 */
export function useAppSurface(themeColor = '#f3f1eb') {
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.surface = 'workspace';
    const theme = document.querySelector('meta[name="theme-color"]');
    const previous = theme?.getAttribute('content') ?? null;
    theme?.setAttribute('content', themeColor);
    return () => {
      delete root.dataset.surface;
      if (previous) theme?.setAttribute('content', previous);
    };
  }, [themeColor]);
}
