import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { ROLE_LABEL, profileUpdateSchema, type ProfileUpdate, type SessionUser } from '@gs/shared';
import { useAuth } from '../../auth/AuthProvider';
import { ChangePasswordModal } from '../../components/ChangePasswordModal';
import { ErrorBanner, FieldError } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { api } from '../../lib/api';
import { formResolver } from '../../lib/zodForm';
import { squareImage } from '../../lib/image';
import s from './MyProfile.module.css';
import { initials } from '../../components/Avatar';
import { icons } from '../../layout/icons';
import { useTheme } from '../../layout/theme';

/** Settings → My profile: every signed-in user can change their picture, name and password. */
export function MyProfile() {
  const { user, updateUser } = useAuth();
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'photo' | 'name' | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [pwOpen, setPwOpen] = useState(false);
  const [theme, setTheme] = useTheme();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<ProfileUpdate>({
    resolver: formResolver(profileUpdateSchema),
    defaultValues: { fullName: user?.fullName ?? '' },
  });
  if (!user) return null;

  const run = async (
    kind: 'photo' | 'name',
    work: () => Promise<{ user: SessionUser }>,
    done: string,
  ) => {
    setBusy(kind);
    setError(null);
    try {
      const res = await work();
      updateUser(res.user);
      toast(done);
      return res.user;
    } catch (e) {
      setError(e);
      return null;
    } finally {
      setBusy(null);
    }
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      setError(new Error('Use a PNG, JPG or WEBP picture.'));
      return;
    }
    await run(
      'photo',
      async () => {
        const fd = new FormData();
        fd.append('file', await squareImage(file), 'avatar.png');
        return api<{ user: SessionUser }>('/auth/me/avatar', { method: 'POST', body: fd });
      },
      'Profile picture updated.',
    );
  };

  const saveName = handleSubmit(async (v) => {
    const u = await run(
      'name',
      () => api<{ user: SessionUser }>('/auth/me', { method: 'PATCH', json: v }),
      'Name updated.',
    );
    if (u) reset({ fullName: u.fullName });
  });

  return (
    <div className={s.wrap}>
      <ErrorBanner error={error} />
      <section className={s.card}>
        <div className={s.photo}>
          <div
            className={s.avatar}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void upload(e.dataTransfer.files[0]);
            }}
          >
            {user.avatarUrl ? (
              <img src={user.avatarUrl} alt={`${user.fullName}'s profile picture`} />
            ) : (
              <span aria-hidden="true">{initials(user.fullName)}</span>
            )}
            {busy === 'photo' && <span className={s.spinner} aria-label="Uploading" />}
          </div>
          <div className={s.photoText}>
            <h3>Profile picture</h3>
            <p>Shown in the sidebar. PNG, JPG or WEBP; it's cropped to a square.</p>
            <div className={s.photoActions}>
              <button
                type="button"
                className={s.primary}
                disabled={busy !== null}
                onClick={() => fileInput.current?.click()}
              >
                {user.avatarUrl ? 'Change picture' : 'Upload picture'}
              </button>
              {user.avatarUrl && (
                <button
                  type="button"
                  className={s.ghost}
                  disabled={busy !== null}
                  onClick={() =>
                    void run(
                      'photo',
                      () => api<{ user: SessionUser }>('/auth/me/avatar', { method: 'DELETE' }),
                      'Profile picture removed.',
                    )
                  }
                >
                  Remove
                </button>
              )}
            </div>
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={(e) => {
                void upload(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </div>
        </div>

        <form
          className={s.details}
          onSubmit={(e) => {
            e.preventDefault();
            void saveName();
          }}
          noValidate
        >
          <label className={s.field}>
            <span>Full name</span>
            <div className={s.nameRow}>
              <input
                className="form-field-box"
                autoComplete="name"
                {...register('fullName')}
                aria-invalid={!!errors.fullName}
              />
              <button type="submit" className={s.primary} disabled={!isDirty || busy !== null}>
                Save
              </button>
            </div>
            <FieldError message={errors.fullName?.message} />
          </label>
          <div className={s.readonly}>
            <div>
              <span>Email</span>
              <b>{user.email}</b>
            </div>
            <div>
              <span>Role</span>
              <b>{ROLE_LABEL[user.role]}</b>
            </div>
            <div>
              <span>Password</span>
              <button type="button" className={s.link} onClick={() => setPwOpen(true)}>
                Change password
              </button>
            </div>
          </div>
          <p className={s.hint}>Your email and role are set by an Admin in Staff Management.</p>
        </form>
      </section>
      <section className={s.appearance}>
        <div>
          <h3>Appearance</h3>
          <p>Light or dark theme for this browser.</p>
        </div>
        <div className={s.themes} role="group" aria-label="Theme">
          {(['light', 'dark'] as const).map((t) => (
            <button key={t} type="button" aria-pressed={theme === t} onClick={() => setTheme(t)}>
              {t === 'light' ? icons.sun({}) : icons.moon({})}
              {t === 'light' ? 'Light' : 'Dark'}
            </button>
          ))}
        </div>
      </section>
      {pwOpen && <ChangePasswordModal onClose={() => setPwOpen(false)} />}
    </div>
  );
}
