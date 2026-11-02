import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { ApiError } from './lib/api';
import { AuthProvider } from './auth/AuthProvider';
import { ToastProvider } from './components/Toast';
import { router } from './router';
import './lib/khmerFont';
import './lib/datePicker';
import './styles/fonts.css';
import './styles/tokens.css';
import './styles/prototype.css';
import './styles/app.css';
import './styles/buttons.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      // Don't retry errors the user can't fix by waiting.
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
