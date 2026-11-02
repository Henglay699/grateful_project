import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ASSISTANT_FILE_ACCEPT, ASSISTANT_FILES_PER_MESSAGE } from '@gs/shared';
import {
  assistantFollowUps,
  assistantStatus,
  assistantSuggestions,
  pageSection,
  pickSome,
  prepareFile,
  streamChat,
  type ChatFile,
  type ChatMessage,
} from '../lib/assistant';
import { fmtFileSize } from '../lib/format';
import { icons } from './icons';
import { GeminiLogo } from './GeminiLogo';
import a from './AskAi.module.css';

/** Sent when the user attaches files without typing a question. */
const ANALYSE = 'Please analyse the attached file(s).';
const KIND_BADGE = { pdf: 'PDF', word: 'DOC', excel: 'XLS', image: 'IMG' } as const;

/** File chip: thumbnail for images, a coloured badge for documents; x to remove when pending. */
function FileChip({ f, onRemove }: { f: ChatFile; onRemove?: () => void }) {
  return (
    <span className={a.chip} data-kind={f.kind} title={f.file.name}>
      {f.preview ? (
        <img src={f.preview} alt="" className={a.thumb} />
      ) : (
        <span className={a.badge}>{KIND_BADGE[f.kind]}</span>
      )}
      <span className={a.chipText}>
        <span className={a.chipName}>{f.file.name}</span>
        <span className={a.chipSize}>{fmtFileSize(f.file.size)}</span>
      </span>
      {onRemove && (
        <button
          type="button"
          className={a.remove}
          onClick={onRemove}
          aria-label={`Remove ${f.file.name}`}
        >
          {icons.close({})}
        </button>
      )}
    </span>
  );
}

/** Shown until the page's own suggestions arrive (or if they can't be fetched). */
const FALLBACK_SUGGESTIONS = [
  'How do I create a new shipment?',
  'Where can I see unpaid invoices?',
  'How do I import a CDC master list?',
  'What does CY / CY mean?',
];
const SHOWN_SUGGESTIONS = 4;

/** Panel width: the default is also the minimum; drag the left edge to widen it. */
const MIN_WIDTH = 420;
const WIDTH_KEY = 'gs:ai-panel-width';
const maxWidth = () => Math.max(MIN_WIDTH, Math.min(960, window.innerWidth - 80));
const clampWidth = (w: number) => Math.round(Math.min(Math.max(w, MIN_WIDTH), maxWidth()));

function readWidth(): number {
  try {
    const saved = Number(localStorage.getItem(WIDTH_KEY));
    return saved ? clampWidth(saved) : MIN_WIDTH;
  } catch {
    return MIN_WIDTH;
  }
}

/** "Ask AI" top-bar button and the help-assistant chat panel it opens. */
export function AskAi() {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{
    message: string;
    question?: string;
    files?: ChatFile[];
  } | null>(null);
  // Files waiting to go with the next question, and why a file was refused.
  const [pending, setPending] = useState<ChatFile[]>([]);
  const [fileNote, setFileNote] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [width, setWidth] = useState(readWidth);
  const [resizing, setResizing] = useState(false);
  // Which suggestions are shown: a new pick each time the panel opens or a chat restarts.
  const [seed, setSeed] = useState(() => Date.now() % 997);
  // Follow-up questions under the latest answer; askId ignores those of an older question.
  const [followUps, setFollowUps] = useState<string[]>([]);
  const askId = useRef(0);

  useEffect(() => {
    try {
      localStorage.setItem(WIDTH_KEY, String(width));
    } catch {
      /* private mode */
    }
  }, [width]);

  function onResizeStart(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setResizing(true);
  }
  function onResizeMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (resizing) setWidth(clampWidth(window.innerWidth - e.clientX));
  }
  function onResizeKey(e: ReactKeyboardEvent<HTMLDivElement>) {
    const step = e.shiftKey ? 80 : 20;
    if (e.key === 'ArrowLeft') setWidth((w) => clampWidth(w + step));
    else if (e.key === 'ArrowRight') setWidth((w) => clampWidth(w - step));
    else if (e.key === 'Home') setWidth(MIN_WIDTH);
    else if (e.key === 'End') setWidth(maxWidth());
    else return;
    e.preventDefault();
  }
  const status = useQuery({
    queryKey: ['assistant', 'status'],
    queryFn: assistantStatus,
    enabled: open,
    staleTime: 5 * 60_000,
  });
  const disabled = status.data?.enabled === false;
  const section = pageSection(location.pathname);
  // Written by the AI from its guide for this page and role, so new features appear on their own.
  const suggested = useQuery({
    queryKey: ['assistant', 'suggestions', section],
    queryFn: () => assistantSuggestions(location.pathname),
    enabled: open && status.data?.enabled === true,
    staleTime: 30 * 60_000,
  });
  const suggestionPool = suggested.data?.questions.length
    ? suggested.data.questions
    : FALLBACK_SUGGESTIONS;
  const shownSuggestions = pickSome(suggestionPool, SHOWN_SUGGESTIONS, seed);

  useEffect(() => {
    if (!open) return;
    setSeed((x) => x + 1);
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, error]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Thumbnails are blob: URLs; free them when the chat is cleared or the page closes.
  const previewsRef = useRef(new Set<string>());
  useEffect(() => {
    const previews = previewsRef.current;
    return () => previews.forEach((u) => URL.revokeObjectURL(u));
  }, []);
  const releaseAll = () => {
    previewsRef.current.forEach((u) => URL.revokeObjectURL(u));
    previewsRef.current.clear();
  };

  async function addFiles(list: FileList | File[]) {
    const incoming = [...list];
    if (!incoming.length) return;
    let note: string | null = null;
    const room = ASSISTANT_FILES_PER_MESSAGE - pending.length;
    if (incoming.length > room)
      note = `You can attach up to ${ASSISTANT_FILES_PER_MESSAGE} files to one question.`;
    const added: ChatFile[] = [];
    for (const file of incoming.slice(0, Math.max(0, room))) {
      const r = await prepareFile(file);
      if (typeof r === 'string') note = r;
      else {
        if (r.preview) previewsRef.current.add(r.preview);
        added.push(r);
      }
    }
    setFileNote(note);
    if (added.length) setPending((p) => [...p, ...added].slice(0, ASSISTANT_FILES_PER_MESSAGE));
    inputRef.current?.focus();
  }

  function removePending(f: ChatFile) {
    if (f.preview) {
      URL.revokeObjectURL(f.preview);
      previewsRef.current.delete(f.preview);
    }
    setPending((p) => p.filter((x) => x !== f));
  }

  async function ask(question: string, files: ChatFile[] = pending) {
    const text = question.trim() || (files.length ? ANALYSE : '');
    if (!text || busy) return;
    const history: ChatMessage[] = [
      ...messages,
      { role: 'user', content: text, ...(files.length ? { files } : {}) },
    ];
    // Send the last ~20 messages, starting with a question (the APIs reject a leading answer).
    let recent = history.slice(-21);
    while (recent[0]?.role === 'assistant') recent = recent.slice(1);
    setMessages([...history, { role: 'assistant', content: '' }]);
    setInput('');
    setPending([]);
    setFileNote(null);
    setError(null);
    setBusy(true);
    setFollowUps([]);
    const id = ++askId.current;
    let answer = '';
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      await streamChat(
        recent,
        location.pathname,
        (chunk) => {
          answer += chunk;
          setMessages((m) => {
            const last = m[m.length - 1]!;
            return [...m.slice(0, -1), { ...last, content: last.content + chunk }];
          });
        },
        ctrl.signal,
      );
      if (answer.trim())
        void assistantFollowUps(text, answer, location.pathname).then((qs) => {
          if (askId.current === id) setFollowUps(qs);
        });
    } catch (err) {
      if (ctrl.signal.aborted) return;
      const message = err instanceof Error ? err.message : 'Something went wrong.';
      setMessages((m) => {
        // Keep a partial answer. With no answer at all, take the question out of the history
        // (so the next request doesn't hold two questions in a row) and offer Retry instead.
        if (m[m.length - 1]?.content) {
          setError({ message });
          return m;
        }
        setError({ message, question: text, files });
        return m.slice(0, -2);
      });
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null;
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void ask(input);
  }

  function reset() {
    abortRef.current?.abort();
    releaseAll();
    setMessages([]);
    setFollowUps([]);
    askId.current++;
    setSeed((x) => x + 1);
    setPending([]);
    setFileNote(null);
    setError(null);
    setBusy(false);
    inputRef.current?.focus();
  }

  return (
    <>
      <button
        type="button"
        className="ask-ai-btn"
        aria-label="Ask AI"
        title="Ask AI"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="ask-ai-panel"
      >
        <GeminiLogo />
        <span className="topbar-btn-label">Ask AI</span>
      </button>

      <aside
        id="ask-ai-panel"
        className={`ai-panel${open ? ' open' : ''}${resizing ? ' resizing' : ''}`}
        style={{ width: `min(${width}px, 100vw)` }}
        aria-label="AI assistant"
        aria-hidden={!open}
        onDragOver={(e) => {
          if (disabled || !e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(e) => {
          if (disabled || !e.dataTransfer.files.length) return;
          e.preventDefault();
          setDragging(false);
          void addFiles(e.dataTransfer.files);
        }}
      >
        {dragging && (
          <div className={a.dropZone} aria-hidden="true">
            Drop images, PDF, Word or Excel files to attach them
          </div>
        )}
        <div
          className="ai-resize"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize assistant panel"
          aria-valuemin={MIN_WIDTH}
          aria-valuemax={960}
          aria-valuenow={width}
          tabIndex={0}
          title="Drag to resize · double-click to reset"
          onPointerDown={onResizeStart}
          onPointerMove={onResizeMove}
          onPointerUp={() => setResizing(false)}
          onPointerCancel={() => setResizing(false)}
          onDoubleClick={() => setWidth(MIN_WIDTH)}
          onKeyDown={onResizeKey}
        />
        <header className="ai-panel-head">
          <div className="ai-panel-title">
            <GeminiLogo />
            <div>
              <div className="name">GS AI Agent</div>
              <div className="sub">Your guide to GS System</div>
            </div>
          </div>
          {messages.length > 0 && (
            <button type="button" className="ai-panel-link" onClick={reset}>
              New chat
            </button>
          )}
          <button
            type="button"
            className="ai-panel-close"
            onClick={() => setOpen(false)}
            aria-label="Close assistant"
          >
            {icons.close({})}
          </button>
        </header>

        <div className="ai-panel-body" ref={listRef} aria-live="polite">
          {messages.length === 0 && (
            <div className="ai-welcome">
              <p>
                Hi! Ask me how to do something in the system, where to find a page, or what a field
                or term means.
              </p>
              <div className="ai-suggestions">
                {shownSuggestions.map((s) => (
                  <button key={s} type="button" onClick={() => void ask(s)} disabled={disabled}>
                    {s}
                  </button>
                ))}
              </div>
              {suggestionPool.length > SHOWN_SUGGESTIONS && (
                <button
                  type="button"
                  className={a.moreQuestions}
                  onClick={() => setSeed((x) => x + 1)}
                  disabled={disabled}
                >
                  ↻ Other questions
                </button>
              )}
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`ai-msg ${m.role}`}>
              {m.role === 'assistant' ? (
                m.content ? (
                  <Markdown text={m.content} />
                ) : (
                  <span className="ai-typing" aria-label="Thinking">
                    <i />
                    <i />
                    <i />
                  </span>
                )
              ) : (
                <>
                  {m.files && (
                    <span className={a.sentFiles}>
                      {m.files.map((f, j) => (
                        <FileChip key={j} f={f} />
                      ))}
                    </span>
                  )}
                  {m.content}
                </>
              )}
            </div>
          ))}
          {/* Follow-ups the AI suggests after its latest answer. */}
          {!busy && followUps.length > 0 && messages[messages.length - 1]?.role === 'assistant' && (
            <div className={a.followUps}>
              <span className={a.followLabel}>Related questions</span>
              {followUps.map((q) => (
                <button key={q} type="button" onClick={() => void ask(q)} disabled={disabled}>
                  {q}
                </button>
              ))}
            </div>
          )}
          {error && (
            <div className="ai-error">
              {error.question && <div className="ai-error-q">“{error.question}”</div>}
              {error.message}
              {error.question && (
                <button
                  type="button"
                  className="ai-retry"
                  onClick={() => void ask(error.question!, error.files ?? [])}
                  disabled={busy}
                >
                  Retry
                </button>
              )}
            </div>
          )}
          {disabled && (
            <div className="ai-error">
              The assistant is not set up yet. An administrator must add an AI API key to the server
              configuration.
            </div>
          )}
        </div>

        <form className={`ai-input ${a.form}`} onSubmit={onSubmit}>
          {pending.length > 0 && (
            <div className={a.pending}>
              {pending.map((f, i) => (
                <FileChip key={i} f={f} onRemove={() => removePending(f)} />
              ))}
            </div>
          )}
          <input
            ref={fileRef}
            type="file"
            accept={ASSISTANT_FILE_ACCEPT}
            multiple
            hidden
            onChange={(e) => {
              void addFiles(e.target.files ?? []);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            className={a.attach}
            onClick={() => fileRef.current?.click()}
            disabled={disabled || busy || pending.length >= ASSISTANT_FILES_PER_MESSAGE}
            aria-label="Attach files"
            title="Attach images, PDF, Word or Excel (max 10 MB each)"
          >
            {icons.plus({})}
          </button>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void ask(input);
              }
            }}
            onPaste={(e) => {
              if (!e.clipboardData.files.length) return;
              e.preventDefault();
              void addFiles(e.clipboardData.files);
            }}
            placeholder={
              pending.length ? 'Ask about the attached file…' : 'Ask anything about the system…'
            }
            aria-label="Your question"
            rows={1}
            maxLength={4000}
            disabled={disabled}
          />
          <button
            type="submit"
            aria-label="Send"
            disabled={busy || disabled || (!input.trim() && !pending.length)}
          >
            {icons.send({})}
          </button>
        </form>
        {fileNote && (
          <p className={a.fileNote} role="alert">
            {fileNote}
          </p>
        )}
        <p className="ai-disclaimer">
          AI answers can be wrong. Check important steps. Attached files are only read for this chat
          and are not saved.
        </p>
      </aside>
    </>
  );
}

/* ---------- Minimal, safe Markdown: paragraphs, lists, **bold**, `code`, [links](/path). ---------- */

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = out.length;
    if (m[1]) out.push(<strong key={key}>{m[1]}</strong>);
    else if (m[2]) out.push(<code key={key}>{m[2]}</code>);
    else if (m[4]!.startsWith('/') && !m[4]!.startsWith('//'))
      out.push(
        <Link key={key} to={m[4]!}>
          {m[3]}
        </Link>,
      );
    else out.push(m[3]); // external links are shown as plain text
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const items = list.items.map((it, i) => <li key={i}>{inline(it)}</li>);
    blocks.push(
      list.ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>,
    );
    list = null;
  };
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    const ol = /^\s*[\d០-៩]+[.)]\s+(.*)$/.exec(line);
    const ul = /^\s*[-*•]\s+(.*)$/.exec(line);
    if (ol || ul) {
      const ordered = Boolean(ol);
      if (list && list.ordered !== ordered) flush();
      list ??= { ordered, items: [] };
      list.items.push((ol ?? ul)![1]!);
    } else if (!line.trim()) {
      flush();
    } else {
      flush();
      const h = /^#{1,6}\s+(.*)$/.exec(line);
      blocks.push(
        h ? (
          <p key={blocks.length}>
            <strong>{inline(h[1]!)}</strong>
          </p>
        ) : (
          <p key={blocks.length}>{inline(line)}</p>
        ),
      );
    }
  }
  flush();
  return <Fragment>{blocks}</Fragment>;
}
