import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ApiError } from '../lib/api';
import { LoginPage } from './LoginPage';

const login = vi.fn();
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ status: 'anonymous', login }) }));

const setup = () =>
  render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  );

describe('LoginPage', () => {
  it('validates before calling the API', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
    expect(screen.getByText('Enter your password')).toBeInTheDocument();
    expect(login).not.toHaveBeenCalled();
  });

  it('shows the server message on a wrong password', async () => {
    login.mockRejectedValueOnce(
      new ApiError(401, 'UNAUTHENTICATED', 'Email or password is incorrect'),
    );
    setup();
    await userEvent.type(screen.getByLabelText('Work email'), 'aden.whitfield@gs.local');
    await userEvent.type(screen.getByLabelText('Password'), 'nope');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect');
    expect(login).toHaveBeenCalledWith({ email: 'aden.whitfield@gs.local', password: 'nope' });
  });
});
