import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
} from 'react';
import {
  CHAT_FILE_ACCEPT,
  CHAT_FILE_MAX_BYTES,
  CHAT_PAGE_SIZE,
  CHAT_STICKER_PACKS,
  type ChatConversationRow,
  type ChatMember,
  type ChatMessageRow,
} from '@gs/shared';
import { useAuth } from '../../auth/AuthProvider';
import { Avatar } from '../../components/Avatar';
import { DocumentPreview } from '../../components/DocumentPreview';
import { ApiError } from '../../lib/api';
import {
  chatApi,
  filePath,
  useAuthedImage,
  useChatEvents,
  useChatInfo,
  useConversation,
} from '../../lib/chat';
import { fmtFileSize } from '../../lib/format';
import { icons } from '../icons';
import { ChatAvatar, dayLabel, msgTime } from './parts';
import c from './Chat.module.css';

const errorText = (e: unknown) =>
  e instanceof ApiError ? e.message : 'Something went wrong. Try again.';

/** Add rows, dropping ones we already have, in seq order. */
function merge(list: ChatMessageRow[], add: ChatMessageRow[]): ChatMessageRow[] {
  const seen = new Set(list.map((m) => m.id));
  const fresh = add.filter((m) => !seen.has(m.id));
  return fresh.length ? [...list, ...fresh].sort((a, b) => a.seq - b.seq) : list;
}

/** Messages of one chat, with the composer. */
export function ChatView({
  conv,
  active,
  onBack,
  onInfo,
}: {
  conv: ChatConversationRow;
  /** Panel open and this chat on screen: new messages count as read. */
  active: boolean;
  onBack: () => void;
  onInfo: () => void;
}) {
  const { user } = useAuth();
  const retentionDays = useChatInfo().data?.retentionDays ?? 0;
  const myId = user!.id;
  const id = conv.id;
  const [msgs, setMsgs] = useState<ChatMessageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [stickers, setStickers] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [viewing, setViewing] = useState<ChatMessageRow | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const msgsRef = useRef(msgs);
  msgsRef.current = msgs;
  // Scroll handling: stick to the bottom for new messages, keep position when older load.
  const stick = useRef(true);
  const keepFrom = useRef<number | null>(null);
  const readSeq = useRef(0);
  // @mentions (groups): the word being typed after "@", the highlighted suggestion, and
  // who was picked (id → name) so the ids go with the message.
  const members = useConversation(conv.kind === 'GROUP' ? conv.id : null).data?.members;
  const names = useMemo(() => new Map(members?.map((m) => [m.id, m.fullName])), [members]);
  const [mentionQ, setMentionQ] = useState<string | null>(null);
  const [mentionIdx, setMentionIdx] = useState(0);
  const picked = useRef(new Map<string, string>());
  const suggestions = useMemo(() => {
    if (mentionQ === null || !members) return [];
    const q = mentionQ.toLowerCase();
    return members
      .filter((m) => m.id !== myId)
      .filter(
        (m) =>
          !q ||
          m.fullName
            .toLowerCase()
            .split(/\s+/)
            .some((w) => w.startsWith(q)),
      )
      .slice(0, 6);
  }, [mentionQ, members, myId]);

  const trackMention = (value: string, caret: number) => {
    const m = conv.kind === 'GROUP' ? /(?:^|\s)@([^\s@]{0,30})$/.exec(value.slice(0, caret)) : null;
    setMentionQ(m ? m[1]! : null);
    setMentionIdx(0);
  };
  const insertMention = (u: ChatMember) => {
    const el = inputRef.current;
    const caret = el?.selectionStart ?? text.length;
    const before = text.slice(0, caret).replace(/@[^\s@]*$/, `@${u.fullName} `);
    setText(before + text.slice(caret));
    picked.current.set(u.id, u.fullName);
    setMentionQ(null);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(before.length, before.length);
    });
  };

  useEffect(() => {
    let cancelled = false;
    setMsgs([]);
    setLoading(true);
    setError(null);
    setText('');
    setFile(null);
    setStickers(false);
    setMentionQ(null);
    picked.current.clear();
    stick.current = true;
    readSeq.current = 0;
    chatApi
      .messages(id)
      .then((rows) => {
        if (cancelled) return;
        setMsgs(rows);
        setHasMore(rows.length === CHAT_PAGE_SIZE);
      })
      .catch((e) => !cancelled && setError(errorText(e)))
      .finally(() => !cancelled && setLoading(false));
    inputRef.current?.focus();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const catchUp = useCallback(async () => {
    const last = msgsRef.current.at(-1)?.seq ?? 0;
    const rows = await chatApi.messages(id, { after: last }).catch(() => []);
    if (rows.length) setMsgs((m) => merge(m, rows));
  }, [id]);

  useChatEvents(
    useCallback(
      (e) => {
        if (e.type === 'reconnected') return void catchUp();
        if (e.type === 'ping' || e.conversationId !== id) return;
        if (e.type === 'message') void catchUp();
        if (e.type === 'deleted')
          setMsgs((m) =>
            m.map((x) =>
              x.id === e.messageId
                ? { ...x, deleted: true, body: '', sticker: null, fileName: null }
                : x,
            ),
          );
      },
      [id, catchUp],
    ),
  );

  // Mark as read while the chat is on screen.
  useEffect(() => {
    const last = msgs.at(-1)?.seq ?? 0;
    if (!active || last <= readSeq.current) return;
    const mark = () => {
      if (document.visibilityState !== 'visible' || last <= readSeq.current) return;
      readSeq.current = last;
      void chatApi.read(id, last).catch(() => undefined);
    };
    mark();
    document.addEventListener('visibilitychange', mark);
    return () => document.removeEventListener('visibilitychange', mark);
  }, [msgs, active, id]);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (keepFrom.current !== null) {
      el.scrollTop = el.scrollHeight - keepFrom.current;
      keepFrom.current = null;
    } else if (stick.current) el.scrollTop = el.scrollHeight;
  }, [msgs]);

  const loadOlder = async () => {
    const first = msgs[0]?.seq;
    if (!first || !hasMore || loading) return;
    setLoading(true);
    try {
      const rows = await chatApi.messages(id, { before: first });
      keepFrom.current = listRef.current
        ? listRef.current.scrollHeight - listRef.current.scrollTop
        : null;
      setHasMore(rows.length === CHAT_PAGE_SIZE);
      setMsgs((m) => merge(m, rows));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  };

  const pick = (f: File | undefined) => {
    if (!f) return;
    if (f.size > CHAT_FILE_MAX_BYTES) {
      setError(`${f.name} is over ${fmtFileSize(CHAT_FILE_MAX_BYTES)}.`);
      return;
    }
    setError(null);
    setFile(f);
    inputRef.current?.focus();
  };

  const run = async (work: () => Promise<ChatMessageRow>) => {
    setSending(true);
    setError(null);
    try {
      const row = await work();
      stick.current = true;
      setMsgs((m) => merge(m, [row]));
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const send = async () => {
    const body = text.trim();
    if (sending || (!body && !file)) return;
    // Picked names still in the text are the mentions.
    const mentionIds = [...picked.current]
      .filter(([, name]) => body.includes(`@${name}`))
      .map(([uid]) => uid);
    const ok = await run(() =>
      file ? chatApi.sendFile(id, file, body) : chatApi.send(id, { body, mentionIds }),
    );
    if (ok) {
      setText('');
      setFile(null);
      setMentionQ(null);
      picked.current.clear();
    }
  };

  const sendSticker = (key: string) => {
    setStickers(false);
    void run(() => chatApi.send(id, { sticker: key }));
  };

  const remove = async (m: ChatMessageRow) => {
    if (!window.confirm('Delete this message for everyone?')) return;
    try {
      await chatApi.remove(m.id);
      setMsgs((list) => list.map((x) => (x.id === m.id ? { ...x, deleted: true } : x)));
    } catch (e) {
      setError(errorText(e));
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    pick(e.dataTransfer.files[0]);
  };
  const onPaste = (e: ClipboardEvent) => {
    const f = e.clipboardData.files[0];
    if (f) {
      e.preventDefault();
      pick(f);
    }
  };

  const group = conv.kind === 'GROUP';
  return (
    <section
      className={c.chat}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <header className={c.chatHead}>
        <button type="button" className={c.back} onClick={onBack} aria-label="Back to chats">
          {icons.back({})}
        </button>
        <button
          type="button"
          className={c.headInfo}
          onClick={onInfo}
          aria-label={group ? 'Group info' : `About ${conv.title}`}
        >
          <ChatAvatar conv={conv} size={38} />
          <span>
            <b>{conv.title}</b>
            <small>{group ? `${conv.memberCount} members` : 'Direct message'}</small>
          </span>
        </button>
      </header>

      <div
        className={c.messages}
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          if (el.scrollTop < 60) void loadOlder();
        }}
        aria-live="polite"
      >
        {retentionDays > 0 && !hasMore && (
          <p className={c.retention}>
            Messages and files are deleted automatically after {retentionDays} days.
          </p>
        )}
        {loading && !msgs.length && <p className={c.muted}>Loading…</p>}
        {!loading && !msgs.length && <p className={c.emptyChat}>No messages yet. Say hello 👋</p>}
        {msgs.map((m, i) => {
          const prev = msgs[i - 1];
          const newDay =
            !prev ||
            new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
          const runStart =
            newDay || !prev || prev.senderId !== m.senderId || prev.kind === 'SYSTEM';
          return (
            <Fragment key={m.id}>
              {newDay && <div className={c.day}>{dayLabel(m.createdAt)}</div>}
              <Message
                m={m}
                mine={m.senderId === myId}
                showSender={group && runStart}
                names={names}
                myId={myId}
                onOpen={() => setViewing(m)}
                onDelete={() => void remove(m)}
              />
            </Fragment>
          );
        })}
      </div>

      {error && (
        <div className={c.error} role="alert">
          {error}
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss">
            {icons.close({})}
          </button>
        </div>
      )}

      {stickers && <StickerPicker onPick={sendSticker} onClose={() => setStickers(false)} />}

      {suggestions.length > 0 && (
        <ul className={c.mentions} role="listbox" aria-label="Mention someone">
          {suggestions.map((u, i) => (
            <li
              key={u.id}
              role="option"
              aria-selected={i === mentionIdx}
              // mousedown, so the textarea keeps focus and its caret
              onMouseDown={(e) => {
                e.preventDefault();
                insertMention(u);
              }}
              onMouseEnter={() => setMentionIdx(i)}
            >
              <Avatar name={u.fullName} src={u.avatarUrl} size={26} />
              {u.fullName}
            </li>
          ))}
        </ul>
      )}

      {file && (
        <div className={c.pending}>
          <FileBadge name={file.name} />
          <span className={c.pendingName}>
            <FileName name={file.name} />
            <small>{fmtFileSize(file.size)} · add a caption below, then send</small>
          </span>
          <button
            type="button"
            className={c.iconBtn}
            onClick={() => setFile(null)}
            aria-label={`Remove ${file.name}`}
          >
            {icons.close({})}
          </button>
        </div>
      )}

      <form
        className={c.composer}
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <button
          type="button"
          className={c.iconBtn}
          aria-label="Stickers"
          aria-expanded={stickers}
          onClick={() => setStickers((s) => !s)}
        >
          {icons.smile({})}
        </button>
        <button
          type="button"
          className={c.iconBtn}
          aria-label="Attach a file"
          onClick={() => fileRef.current?.click()}
        >
          {icons.paperclip({})}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept={CHAT_FILE_ACCEPT}
          hidden
          onChange={(e) => {
            pick(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <textarea
          ref={inputRef}
          rows={1}
          value={text}
          maxLength={4000}
          placeholder={file ? 'Add a caption…' : 'Write a message…'}
          aria-label="Message"
          onChange={(e) => {
            setText(e.target.value);
            trackMention(e.target.value, e.target.selectionStart);
          }}
          onClick={(e) => trackMention(text, e.currentTarget.selectionStart)}
          onPaste={onPaste}
          onKeyDown={(e) => {
            if (suggestions.length) {
              const n = suggestions.length;
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                setMentionIdx((i) => (i + (e.key === 'ArrowDown' ? 1 : n - 1)) % n);
                return;
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                insertMention(suggestions[mentionIdx] ?? suggestions[0]!);
                return;
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                setMentionQ(null);
                return;
              }
            }
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button
          type="submit"
          className={c.sendBtn}
          disabled={sending || (!text.trim() && !file)}
          aria-label="Send"
        >
          {icons.send({})}
        </button>
      </form>

      {dragging && (
        <div className={c.dropZone} aria-hidden="true">
          Drop the file to send it
        </div>
      )}

      {viewing && viewing.fileName && (
        <DocumentPreview
          doc={{
            id: viewing.id,
            title: viewing.fileName,
            originalName: viewing.fileName,
            mimeType: viewing.fileMime ?? 'application/octet-stream',
            sizeBytes: viewing.fileSize ?? 0,
            createdAt: viewing.createdAt,
            uploadedBy: viewing.senderName,
          }}
          path={filePath(viewing.id)}
          onClose={() => setViewing(null)}
        />
      )}
    </section>
  );
}

function Message({
  m,
  mine,
  showSender,
  names,
  myId,
  onOpen,
  onDelete,
}: {
  m: ChatMessageRow;
  mine: boolean;
  showSender: boolean;
  names: Map<string, string>;
  myId: string;
  onOpen: () => void;
  onDelete: () => void;
}) {
  if (m.kind === 'SYSTEM') return <div className={c.system}>{m.body}</div>;
  const sticker = m.kind === 'STICKER' && !m.deleted;
  return (
    <div className={c.row} data-mine={mine || undefined} data-first={showSender || undefined}>
      {!mine && (
        <span className={c.rowAvatar}>
          {showSender && <Avatar name={m.senderName ?? '?'} src={m.senderAvatarUrl} size={30} />}
        </span>
      )}
      <div
        className={sticker ? c.sticker : c.bubble}
        data-deleted={m.deleted || undefined}
        data-mentioned={(!m.deleted && m.mentionIds.includes(myId)) || undefined}
      >
        {showSender && !mine && <div className={c.sender}>{m.senderName ?? 'Deleted user'}</div>}
        {m.deleted ? (
          <i>Message deleted</i>
        ) : sticker ? (
          <span className={c.stickerGlyph} role="img" aria-label={`Sticker ${m.body}`}>
            {m.body}
          </span>
        ) : (
          <>
            {m.kind === 'FILE' && <Attachment m={m} onOpen={onOpen} />}
            {m.body && (
              <MessageText body={m.body} mentionIds={m.mentionIds} names={names} myId={myId} />
            )}
          </>
        )}
        <span className={c.time}>{msgTime(m.createdAt)}</span>
      </div>
      {mine && !m.deleted && (
        <button
          type="button"
          className={c.deleteBtn}
          onClick={onDelete}
          aria-label="Delete message"
          title="Delete"
        >
          {icons.trash({})}
        </button>
      )}
    </div>
  );
}

const isImage = (mime: string | null) => /^image\/(png|jpeg|webp)$/.test(mime ?? '');

function Attachment({ m, onOpen }: { m: ChatMessageRow; onOpen: () => void }) {
  const src = useAuthedImage(isImage(m.fileMime) ? filePath(m.id) : null);
  if (isImage(m.fileMime))
    return (
      <button type="button" className={c.image} onClick={onOpen} aria-label={`Open ${m.fileName}`}>
        {src ? <img src={src} alt={m.fileName ?? ''} /> : <span className={c.imageWait} />}
      </button>
    );
  return (
    <button type="button" className={c.file} onClick={onOpen}>
      <FileBadge name={m.fileName ?? ''} />
      <span>
        <FileName name={m.fileName ?? ''} />
        <small>{fmtFileSize(m.fileSize ?? 0)}</small>
      </span>
    </button>
  );
}

/** Long names end in "…" but keep their extension: "Commercial invoice JR-26…pdf". */
function FileName({ name }: { name: string }) {
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 && name.length - dot <= 6 ? name.slice(dot) : '';
  return (
    <span className={c.fileName} title={name}>
      <span>{ext ? name.slice(0, dot) : name}</span>
      {ext}
    </span>
  );
}

/** Message text with "@Name" of each mentioned member highlighted (yours stronger). */
function MessageText({
  body,
  mentionIds,
  names,
  myId,
}: {
  body: string;
  mentionIds: string[];
  names: Map<string, string>;
  myId: string;
}) {
  const tags = mentionIds
    .map((uid) => ({ uid, tag: names.get(uid) && `@${names.get(uid)}` }))
    .filter((t): t is { uid: string; tag: string } => !!t.tag)
    .sort((a, b) => b.tag.length - a.tag.length);
  if (!tags.length) return <div className={c.text}>{body}</div>;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = body.split(new RegExp(`(${tags.map((t) => esc(t.tag)).join('|')})`, 'g'));
  return (
    <div className={c.text}>
      {parts.map((p, i) => {
        const t = tags.find((x) => x.tag === p);
        return t ? (
          <span key={i} className={c.at} data-me={t.uid === myId || undefined}>
            {p}
          </span>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        );
      })}
    </div>
  );
}

function FileBadge({ name }: { name: string }) {
  const ext = name.split('.').pop()?.toUpperCase().slice(0, 4) ?? 'FILE';
  return (
    <span className={c.fileBadge} data-ext={ext}>
      {ext}
    </span>
  );
}

function StickerPicker({
  onPick,
  onClose,
}: {
  onPick: (key: string) => void;
  onClose: () => void;
}) {
  const [pack, setPack] = useState(0);
  return (
    <div
      className={c.stickers}
      role="dialog"
      aria-label="Stickers"
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        onClose();
      }}
    >
      <div className={c.packs} role="tablist">
        {CHAT_STICKER_PACKS.map((p, i) => (
          <button
            key={p.name}
            type="button"
            role="tab"
            aria-selected={pack === i}
            onClick={() => setPack(i)}
          >
            {p.name}
          </button>
        ))}
      </div>
      <div className={c.stickerGrid}>
        {Object.entries(CHAT_STICKER_PACKS[pack]!.stickers).map(([key, glyph]) => (
          <button key={key} type="button" onClick={() => onPick(key)} aria-label={`Send ${key}`}>
            {glyph}
          </button>
        ))}
      </div>
    </div>
  );
}
