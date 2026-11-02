import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ChatConversationDetail, ChatConversationRow } from '@gs/shared';
import { useAuth } from '../../auth/AuthProvider';
import { Avatar } from '../../components/Avatar';
import { ApiError } from '../../lib/api';
import { chatApi, chatKeys, useChatUsers, useConversation } from '../../lib/chat';
import { squareImage } from '../../lib/image';
import { icons } from '../icons';
import { ChatAvatar, MemberPicker } from './parts';
import c from './Chat.module.css';

const errorText = (e: unknown) =>
  e instanceof ApiError ? e.message : 'Something went wrong. Try again.';

/** Group details: photo, name, members (add / remove), leave. Read-only for a direct chat. */
export function GroupInfo({
  conv,
  onBack,
  onLeft,
  onMessage,
}: {
  conv: ChatConversationRow;
  onBack: () => void;
  onLeft: () => void;
  /** Open the one-to-one chat with a member. */
  onMessage: (userId: string) => void;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const detail = useConversation(conv.id).data;
  const users = useChatUsers().data ?? [];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [adding, setAdding] = useState<Set<string> | null>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const group = conv.kind === 'GROUP';
  const iOwn = detail?.members.some((m) => m.id === user!.id && m.role === 'OWNER');

  // Calls that return the updated group refresh it in place.
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const d = await work();
      if (d) qc.setQueryData(chatKeys.conversation(conv.id), d as ChatConversationDetail);
      void qc.invalidateQueries({ queryKey: chatKeys.conversations });
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const setPhoto = async (f: File | undefined) => {
    if (!f) return;
    if (!/^image\/(png|jpeg|webp)$/.test(f.type))
      return setError('Use a PNG, JPG or WEBP picture.');
    await run(async () => chatApi.setPhoto(conv.id, await squareImage(f)));
  };

  const memberIds = new Set(detail?.members.map((m) => m.id));
  return (
    <section className={c.info}>
      <header className={c.chatHead}>
        <button type="button" className={c.backAlways} onClick={onBack} aria-label="Back to chat">
          {icons.back({})}
        </button>
        <b className={c.infoTitle}>{group ? 'Group info' : 'Contact'}</b>
      </header>

      <div className={c.infoBody}>
        <div className={c.infoTop}>
          <ChatAvatar conv={detail ?? conv} size={96} />
          {group && (
            <div className={c.photoActions}>
              <button
                type="button"
                className={c.linkBtn}
                disabled={busy}
                onClick={() => photoRef.current?.click()}
              >
                {icons.camera({})}
                {conv.hasPhoto ? 'Change photo' : 'Add photo'}
              </button>
              {conv.hasPhoto && (
                <button
                  type="button"
                  className={c.linkBtn}
                  disabled={busy}
                  onClick={() => void run(() => chatApi.removePhoto(conv.id))}
                >
                  Remove
                </button>
              )}
              <input
                ref={photoRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                hidden
                onChange={(e) => {
                  void setPhoto(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </div>
          )}

          {group && title !== null ? (
            <form
              className={c.renameRow}
              onSubmit={(e) => {
                e.preventDefault();
                const next = title.trim();
                if (!next) return;
                void run(() => chatApi.rename(conv.id, next)).then((ok) => ok && setTitle(null));
              }}
            >
              <input
                className="form-field-box"
                value={title}
                maxLength={80}
                autoFocus
                aria-label="Group name"
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Escape') return;
                  e.preventDefault();
                  setTitle(null);
                }}
              />
              <button type="submit" className={c.primaryBtn} disabled={busy || !title.trim()}>
                Save
              </button>
              <button type="button" className={c.ghostBtn} onClick={() => setTitle(null)}>
                Cancel
              </button>
            </form>
          ) : (
            <h3 className={c.infoName}>
              {conv.title}
              {group && (
                <button
                  type="button"
                  className={c.iconBtn}
                  onClick={() => setTitle(conv.title)}
                  aria-label="Rename group"
                  title="Rename"
                >
                  {icons.edit({})}
                </button>
              )}
            </h3>
          )}
          {group && <small className={c.muted}>{conv.memberCount} members</small>}
        </div>

        {error && (
          <div className={c.error} role="alert">
            {error}
          </div>
        )}

        {group && (
          <>
            <div className={c.sectionHead}>
              <span>Members</span>
              {adding === null && (
                <button type="button" className={c.linkBtn} onClick={() => setAdding(new Set())}>
                  {icons.plus({})}
                  Add members
                </button>
              )}
            </div>

            {adding !== null && (
              <div className={c.addBox}>
                <MemberPicker
                  users={users.filter((u) => !memberIds.has(u.id))}
                  selected={adding}
                  onToggle={(id) => {
                    const next = new Set(adding);
                    if (!next.delete(id)) next.add(id);
                    setAdding(next);
                  }}
                />
                <div className={c.formActions}>
                  <button type="button" className={c.ghostBtn} onClick={() => setAdding(null)}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className={c.primaryBtn}
                    disabled={busy || !adding.size}
                    onClick={() =>
                      void run(() => chatApi.addMembers(conv.id, [...adding])).then(
                        (ok) => ok && setAdding(null),
                      )
                    }
                  >
                    Add {adding.size || ''}
                  </button>
                </div>
              </div>
            )}

            <ul className={c.members}>
              {detail?.members.map((m) => (
                <li key={m.id}>
                  <Avatar name={m.fullName} src={m.avatarUrl} size={34} />
                  <span className={c.memberName}>
                    {m.fullName}
                    {m.id === user!.id && <small> (you)</small>}
                  </span>
                  {m.role === 'OWNER' && <span className={c.ownerTag}>Owner</span>}
                  {m.id !== user!.id && (
                    <button
                      type="button"
                      className={c.iconBtn}
                      onClick={() => onMessage(m.id)}
                      aria-label={`Message ${m.fullName}`}
                      title="Message"
                    >
                      {icons.chat({})}
                    </button>
                  )}
                  {iOwn && m.id !== user!.id && (
                    <button
                      type="button"
                      className={c.iconBtn}
                      disabled={busy}
                      aria-label={`Remove ${m.fullName}`}
                      title="Remove from group"
                      onClick={() =>
                        window.confirm(`Remove ${m.fullName} from ${conv.title}?`) &&
                        void run(async () => {
                          await chatApi.removeMember(conv.id, m.id);
                          await qc.invalidateQueries({ queryKey: chatKeys.conversation(conv.id) });
                        })
                      }
                    >
                      {icons.close({})}
                    </button>
                  )}
                </li>
              ))}
            </ul>

            <button
              type="button"
              className={c.leaveBtn}
              disabled={busy}
              onClick={() =>
                window.confirm(`Leave ${conv.title}? You won't see its messages any more.`) &&
                void run(() => chatApi.removeMember(conv.id, user!.id)).then((ok) => ok && onLeft())
              }
            >
              {icons.signout({})}
              Leave group
            </button>
          </>
        )}
      </div>
    </section>
  );
}
