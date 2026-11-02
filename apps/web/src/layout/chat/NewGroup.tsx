import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Avatar } from '../../components/Avatar';
import { ApiError } from '../../lib/api';
import { chatApi, chatKeys, useChatUsers } from '../../lib/chat';
import { squareImage } from '../../lib/image';
import { icons } from '../icons';
import { MemberPicker } from './parts';
import c from './Chat.module.css';

/** Create a group: name, optional photo, members. */
export function NewGroup({
  onBack,
  onCreated,
}: {
  onBack: () => void;
  onCreated: (id: string) => void;
}) {
  const qc = useQueryClient();
  const users = useChatUsers().data ?? [];
  const [title, setTitle] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const photoRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => void (photoUrl && URL.revokeObjectURL(photoUrl)), [photoUrl]);

  const pickPhoto = async (f: File | undefined) => {
    if (!f) return;
    if (!/^image\/(png|jpeg|webp)$/.test(f.type))
      return setError('Use a PNG, JPG or WEBP picture.');
    try {
      const b = await squareImage(f);
      setPhoto(b);
      setPhotoUrl(URL.createObjectURL(b));
    } catch {
      setError('Could not read that picture.');
    }
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const g = await chatApi.createGroup(title.trim(), [...selected]);
      if (photo) await chatApi.setPhoto(g.id, photo).catch(() => undefined);
      await qc.invalidateQueries({ queryKey: chatKeys.conversations });
      onCreated(g.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={c.info}>
      <header className={c.chatHead}>
        <button type="button" className={c.backAlways} onClick={onBack} aria-label="Back">
          {icons.back({})}
        </button>
        <b className={c.infoTitle}>New group</b>
      </header>
      <form
        className={c.infoBody}
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <div className={c.newTop}>
          <button
            type="button"
            className={c.photoPick}
            onClick={() => photoRef.current?.click()}
            aria-label={photo ? 'Change group photo' : 'Add group photo'}
          >
            {photoUrl ? (
              <Avatar name={title || 'Group'} src={photoUrl} size={72} />
            ) : (
              icons.camera({})
            )}
          </button>
          <input
            ref={photoRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={(e) => {
              void pickPhoto(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <label className={c.field}>
            <span>Group name</span>
            <input
              className="form-field-box"
              value={title}
              maxLength={80}
              autoFocus
              placeholder="e.g. Import team"
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
        </div>

        <div className={c.sectionHead}>
          <span>Members{selected.size ? ` · ${selected.size} selected` : ''}</span>
        </div>
        <MemberPicker
          users={users}
          selected={selected}
          onToggle={(id) => {
            const next = new Set(selected);
            if (!next.delete(id)) next.add(id);
            setSelected(next);
          }}
        />

        {error && (
          <div className={c.error} role="alert">
            {error}
          </div>
        )}
        <div className={c.formActions}>
          <button type="button" className={c.ghostBtn} onClick={onBack}>
            Cancel
          </button>
          <button
            type="submit"
            className={c.primaryBtn}
            disabled={busy || !title.trim() || !selected.size}
          >
            Create group
          </button>
        </div>
      </form>
    </section>
  );
}
