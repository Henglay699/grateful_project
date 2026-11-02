import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';

vi.mock('./auth/AuthProvider', () => ({
  useAuth: () => ({
    status: 'authenticated',
    user: { fullName: 'T', role: 'ADMIN', permissions: [] },
    can: () => true,
    logout: vi.fn(),
  }),
}));
vi.mock('./layout/AppLayout', async () => {
  const { Outlet } = await import('react-router-dom');
  return { AppLayout: () => <Outlet /> };
});
vi.mock('./pages/DocumentsPage', () => ({ DocumentsPage: () => <h2>Documents page</h2> }));

describe('lazy routes', () => {
  it('render a page behind a Suspense boundary', async () => {
    const { router } = await import('./router');
    const memory = createMemoryRouter(router.routes, { initialEntries: ['/documents'] });
    render(<RouterProvider router={memory} />);
    expect(await screen.findByText('Documents page')).toBeInTheDocument();
  });
});
