import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import '@fontsource/pixelify-sans/500.css';
// The workspace's faces (styles/workspace.css). A @font-face only downloads where it is used.
import '@fontsource-variable/inter';
import '@fontsource-variable/newsreader';
import '@harbor/ui/globals.css';

import { Toaster } from '@harbor/ui/components/sonner';
import { TooltipProvider } from '@harbor/ui/components/tooltip';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { router } from './router.tsx';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element.');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RouterProvider router={router} />
        {/* Above the phone's bottom navigation; see --toast-bottom in workspace.css. */}
        <Toaster
          position="bottom-right"
          offset={{ bottom: 'var(--toast-bottom)' }}
          mobileOffset={{ bottom: 'var(--toast-bottom)' }}
        />
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>,
);
