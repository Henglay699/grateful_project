import { Fragment, useState } from 'react';
import { useForm } from 'react-hook-form';
import { clientNoteInputSchema, type ClientNote, type ClientNoteInput } from '@gs/shared';
import { useAuth } from '../../auth/AuthProvider';
import { useClientNotes, useDeleteClientNote, useSaveClientNote } from '../../features/hooks';
import { ErrorBanner, FieldError, Modal, ui } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { icons } from '../../layout/icons';
import { fmtDate } from '../../lib/format';
import { formResolver } from '../../lib/zodForm';
import s from './RemarksCard.module.css';

const URL_RE = /(https?:\/\/[^\s]+|www\.[^\s]+)/g;

/** The note text with its web addresses as links (opened in a new tab). */
function Linked({ text }: { text: string }) {
  return (
    <>
      {text.split(URL_RE).map((part, i) =>
        i % 2 ? (
          <a
            key={i}
            href={part.startsWith('www.') ? `https://${part}` : part}
            target="_blank"
            rel="noopener noreferrer"
          >
            {part}
          </a>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

function Note({
  note,
  editable,
  onEdit,
}: {
  note: ClientNote;
  editable: boolean;
  onEdit: () => void;
}) {
  const toast = useToast();
  const [shown, setShown] = useState(!note.hidden);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(note.body);
      toast(`Copied “${note.subject}”.`);
    } catch {
      toast('Could not copy. Show the text and copy it by hand.');
    }
  };
  return (
    <div className={s.note}>
      <div className={s.noteHead}>
        <b className={s.subject}>{note.subject}</b>
        <div className={s.tools}>
          {note.hidden && (
            <button type="button" className={s.tool} onClick={() => setShown((v) => !v)}>
              {shown ? 'Hide' : 'Show'}
            </button>
          )}
          {note.body && (
            <button type="button" className={s.tool} onClick={() => void copy()}>
              Copy
            </button>
          )}
          {editable && (
            <button
              type="button"
              className={s.icon}
              onClick={onEdit}
              aria-label={`Edit ${note.subject}`}
              title="Edit"
            >
              {icons.edit({ width: 14, height: 14 })}
            </button>
          )}
        </div>
      </div>
      {note.body &&
        (shown ? (
          <div className={s.body}>
            <Linked text={note.body} />
          </div>
        ) : (
          <div className={`${s.body} ${s.masked}`} aria-label="Hidden text">
            ••••••••
          </div>
        ))}
      <div className={s.meta}>
        {note.updatedBy ? `${note.updatedBy} · ` : ''}
        {fmtDate(note.updatedAt)}
      </div>
    </div>
  );
}

/**
 * Client Details → Remarks: notes under a subject for this client, such as a ministry
 * website's login link and password. Hidden notes show their text only on request.
 */
export function RemarksCard({ clientId }: { clientId: string }) {
  const { can } = useAuth();
  const notes = useClientNotes(clientId);
  const [open, setOpen] = useState<ClientNote | 'new' | null>(null);
  const editable = can('clients:write');

  return (
    <div className="card">
      <div className="card-header-row">
        <h3>Remarks</h3>
        {editable && (
          <button type="button" className="filter-btn" onClick={() => setOpen('new')}>
            + Add note
          </button>
        )}
      </div>
      <ErrorBanner error={notes.error} />
      {notes.isLoading ? (
        <span className={s.muted}>Loading…</span>
      ) : notes.data?.length ? (
        <div className={s.list}>
          {notes.data.map((n) => (
            <Note key={n.id} note={n} editable={editable} onEdit={() => setOpen(n)} />
          ))}
        </div>
      ) : (
        <span className={s.muted}>
          No remarks yet.
          {editable ? ' Add logins, links or anything to remember for this client.' : ''}
        </span>
      )}
      {open && (
        <NoteModal
          clientId={clientId}
          note={open === 'new' ? null : open}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

function NoteModal({
  clientId,
  note,
  onClose,
}: {
  clientId: string;
  note: ClientNote | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const save = useSaveClientNote(clientId);
  const del = useDeleteClientNote(clientId);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ClientNoteInput>({
    resolver: formResolver(clientNoteInputSchema),
    defaultValues: {
      subject: note?.subject ?? '',
      body: note?.body ?? '',
      hidden: note?.hidden ?? false,
    },
  });

  const onSubmit = handleSubmit(async (v) => {
    await save.mutateAsync({ id: note?.id, body: v });
    toast(note ? 'Note saved.' : 'Note added.');
    onClose();
  });
  const remove = async () => {
    if (!note || !window.confirm(`Delete the note “${note.subject}”?`)) return;
    await del.mutateAsync(note.id);
    toast('Note deleted.');
    onClose();
  };

  return (
    <Modal
      title={note ? 'Edit note' : 'Add note'}
      sub="A subject and anything to keep for this client: a website and its login, a password, a reminder."
      onClose={onClose}
      width={560}
    >
      <ErrorBanner error={save.error ?? del.error} />
      <form onSubmit={(e) => void onSubmit(e)} noValidate>
        <div className="form-fields-grid" style={{ gridTemplateColumns: '1fr' }}>
          <div className="form-field-group">
            <label htmlFor="note-subject">Subject</label>
            <input
              id="note-subject"
              className="form-field-box"
              placeholder="e.g. GDCE e-Customs login"
              {...register('subject')}
              aria-invalid={!!errors.subject}
            />
            <FieldError message={errors.subject?.message} />
          </div>
          <div className="form-field-group">
            <label htmlFor="note-body">Notes</label>
            <textarea
              id="note-body"
              className="form-field-box"
              rows={6}
              placeholder={'https://…\nUser: …\nPassword: …'}
              {...register('body')}
              aria-invalid={!!errors.body}
            />
            <FieldError message={errors.body?.message} />
          </div>
          <label className={s.check}>
            <input type="checkbox" {...register('hidden')} />
            Hide the text until someone clicks Show (for passwords)
          </label>
        </div>
        <div className={ui.actions}>
          {note && (
            <button type="button" className="btn-delete-shipment" onClick={() => void remove()}>
              Delete note
            </button>
          )}
          <button type="button" className="btn-cancel-shipment" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-create-submit" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : note ? 'Save' : 'Add note'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
