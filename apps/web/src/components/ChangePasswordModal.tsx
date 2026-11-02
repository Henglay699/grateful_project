import { useForm } from 'react-hook-form';
import { changePasswordSchema } from '@gs/shared';
import { useApiMutation } from '../features/admin';
import { api } from '../lib/api';
import { formResolver } from '../lib/zodForm';
import { ErrorBanner, FieldError, Modal, ui } from './ui';
import { useToast } from './Toast';

export function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const save = useApiMutation(
    (v: { currentPassword: string; newPassword: string }) =>
      api('/auth/change-password', { method: 'POST', json: v }),
    [],
  );
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<{ currentPassword: string; newPassword: string }>({
    resolver: formResolver(changePasswordSchema),
  });
  const submit = handleSubmit(async (v) => {
    await save.mutateAsync(v);
    toast('Password changed. Your other devices were signed out.');
    onClose();
  });
  return (
    <Modal
      title="Change your password"
      sub="At least 10 characters, with letters and a number."
      onClose={onClose}
      width={440}
    >
      <ErrorBanner error={save.error} />
      <form onSubmit={(e) => void submit(e)} noValidate>
        <div className="form-fields-grid" style={{ gridTemplateColumns: '1fr' }}>
          <div className="form-field-group">
            <label htmlFor="cp-current">Current password</label>
            <input
              id="cp-current"
              type="password"
              autoComplete="current-password"
              className="form-field-box"
              {...register('currentPassword')}
            />
            <FieldError message={errors.currentPassword?.message} />
          </div>
          <div className="form-field-group">
            <label htmlFor="cp-new">New password</label>
            <input
              id="cp-new"
              type="password"
              autoComplete="new-password"
              className="form-field-box"
              {...register('newPassword')}
            />
            <FieldError message={errors.newPassword?.message} />
          </div>
        </div>
        <div className={ui.actions}>
          <button type="button" className="btn-cancel-shipment" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-create-submit" disabled={save.isPending}>
            Change password
          </button>
        </div>
      </form>
    </Modal>
  );
}
