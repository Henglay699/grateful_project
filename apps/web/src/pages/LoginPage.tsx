import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { loginInputSchema, type LoginInput } from '@gs/shared';
import { useAuth } from '../auth/AuthProvider';
import { ApiError } from '../lib/api';
import { FullPageLoader } from '../components/FullPageLoader';
import styles from './LoginPage.module.css';

const iconProps = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const;

export function LoginPage() {
  const { status, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/'; // "/" picks the first page the role can open
  const [serverError, setServerError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginInputSchema),
    defaultValues: { email: '', password: '' },
  });

  if (status === 'loading') return <FullPageLoader />;
  if (status === 'authenticated') return <Navigate to={from} replace />;

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      await login(values);
      navigate(from, { replace: true });
    } catch (err) {
      setServerError(
        err instanceof ApiError
          ? err.message
          : 'The server could not be reached. Check that the API is running, then try again.',
      );
    }
  });

  return (
    <main className={styles.page}>
      <div className={styles.hero} aria-hidden="true">
        <p className={styles.tagline}>Smart logistics for a connected world</p>
      </div>

      <div className={styles.panel}>
        <div className={styles.brand}>
          <img className={styles.logo} src="/logo.png" alt="Grateful Solutions logo" />
          <div>
            <div className={styles.brandTitle}>Grateful Solutions</div>
            <div className={styles.brandSubtitle}>(Cambodia) Co., Ltd</div>
          </div>
        </div>

        <h1 className={styles.heading}>Sign in</h1>
        <p className={styles.lede}>
          Dashboard, shipping plans, customs, accounting and reporting.
        </p>

        {serverError && (
          <div className={styles.alert} role="alert">
            {serverError}
          </div>
        )}

        <form onSubmit={onSubmit} noValidate>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="email">
              <svg {...iconProps}>
                <rect x="3" y="5" width="18" height="14" rx="2" />
                <path d="m3 7 9 6 9-6" />
              </svg>
              Work email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              autoFocus
              placeholder="Enter your work email"
              className={styles.input}
              aria-invalid={!!errors.email}
              aria-describedby={errors.email ? 'email-error' : undefined}
              {...register('email')}
            />
            {errors.email && (
              <span id="email-error" className={styles.fieldError}>
                {errors.email.message}
              </span>
            )}
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="password">
              <svg {...iconProps}>
                <rect x="4" y="10" width="16" height="11" rx="2" />
                <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                <path d="M12 14.5v2" />
              </svg>
              Password
            </label>
            <div className={styles.inputWrap}>
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="Enter your password"
                className={`${styles.input} ${styles.inputWithToggle}`}
                aria-invalid={!!errors.password}
                aria-describedby={errors.password ? 'password-error' : undefined}
                {...register('password')}
              />
              <button
                type="button"
                className={styles.reveal}
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
              >
                {showPassword ? (
                  <svg {...iconProps}>
                    <path d="M3 3l18 18" />
                    <path d="M10.6 5.1A10.4 10.4 0 0 1 12 5c6 0 9.5 7 9.5 7a17 17 0 0 1-3.2 4.1" />
                    <path d="M6.6 6.6A17 17 0 0 0 2.5 12S6 19 12 19a9.6 9.6 0 0 0 5.4-1.6" />
                    <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
                  </svg>
                ) : (
                  <svg {...iconProps}>
                    <path d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7Z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
            {errors.password && (
              <span id="password-error" className={styles.fieldError}>
                {errors.password.message}
              </span>
            )}
          </div>

          <button type="submit" className={styles.submit} disabled={isSubmitting}>
            <svg {...iconProps} width={20} height={20}>
              <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
              <path d="M10 17l5-5-5-5" />
              <path d="M15 12H3" />
            </svg>
            {isSubmitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className={styles.footer}>
          Forgot your password? Ask an Admin to reset it in Staff &amp; Roles.
        </p>
      </div>
    </main>
  );
}
