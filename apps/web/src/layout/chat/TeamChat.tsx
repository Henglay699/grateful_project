import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthProvider';
import { Avatar } from '../../components/Avatar';
import {
  chatApi,
  chatKeys,
  useChatEvents,
  useChatStream,
  useChatUsers,
  useConversations,
} from '../../lib/chat';
import { icons } from '../icons';
import { ChatView } from './ChatView';
import { GroupInfo } from './GroupInfo';
import { NewGroup } from './NewGroup';
import { ChatAvatar, listTime, preview } from './parts';
import c from './Chat.module.css';

type Mode = 'chat' | 'info' | 'new';

/** Full screen or side panel, remembered in this browser. */
const EXPANDED_KEY = 'gs:chat-expanded';
function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}

/** Top-bar chat button (with the unread count) and the team chat panel it opens. */
export function TeamChat() {
  const { user } = useAuth();
  const qc = useQueryClient();
  useChatStream();
  const conversations = useConversations();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(() => readPref(EXPANDED_KEY) === '1');
  useEffect(() => writePref(EXPANDED_KEY, expanded ? '1' : '0'), [expanded]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('chat');
  const [q, setQ] = useState('');
  const people = useChatUsers(open);
  const list = useMemo(() => conversations.data ?? [], [conversations.data]);
  const unread = list.reduce((n, x) => n + x.unread, 0);
  const active = list.find((x) => x.id === activeId) ?? null;

  // Removed from (or left) the open group: back to the list.
  useChatEvents(
    useCallback(
      (e) => {
        if (e.type === 'removed' && e.conversationId === activeId) {
          setActiveId(null);
          setMode('chat');
        }
      },
      [activeId],
    ),
  );

  const openChat = (id: string) => {
    setActiveId(id);
    setMode('chat');
    setQ('');
  };
  const startDirect = async (userId: string) => {
    const d = await chatApi.direct(userId);
    await qc.invalidateQueries({ queryKey: chatKeys.conversations });
    openChat(d.id);
  };

  const needle = q.trim().toLowerCase();
  const shownChats = needle ? list.filter((x) => x.title.toLowerCase().includes(needle)) : list;
  const directPeers = new Set(list.map((x) => x.peerId));
  // Everyone you have no one-to-one chat with yet, always listed under the chats.
  const shownPeople = (people.data ?? []).filter(
    (u) => (!needle || u.fullName.toLowerCase().includes(needle)) && !directPeers.has(u.id),
  );

  return (
    <>
      <button
        type="button"
        className="icon-btn"
        onClick={() => setOpen((o) => !o)}
        aria-label={unread ? `Chat, ${unread} unread` : 'Chat'}
        aria-expanded={open}
        aria-controls="team-chat"
      >
        {icons.chat({})}
        {unread > 0 && (
          <span key={unread} className="badge" aria-hidden="true">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {/* In <body>: the sticky top bar is its own stacking context, which would put the
          sidebar on top of the full-screen chat. */}
      {createPortal(
        <div
          id="team-chat"
          className={c.panel}
          data-open={open || undefined}
          data-expanded={expanded || undefined}
          data-view={activeId || mode === 'new' ? 'main' : 'list'}
          role="dialog"
          aria-label="Team chat"
          onKeyDown={(e) => {
            // Not for keys from the file viewer (a portal) or ones a picker already handled.
            if (
              e.key === 'Escape' &&
              !e.defaultPrevented &&
              e.currentTarget.contains(e.target as Node)
            )
              setOpen(false);
          }}
        >
          <aside className={c.list}>
            <header className={c.listHead}>
              <b>Chats</b>
              <button
                type="button"
                className={c.newGroupBtn}
                onClick={() => {
                  setActiveId(null);
                  setMode('new');
                }}
              >
                {icons.plus({})}
                New group
              </button>
              <button
                type="button"
                className={`${c.iconBtn} ${c.expandBtn}`}
                onClick={() => setExpanded((x) => !x)}
                aria-label={expanded ? 'Exit full screen' : 'Full screen'}
                aria-pressed={expanded}
                title={expanded ? 'Exit full screen' : 'Full screen'}
              >
                {expanded ? icons.minimize({}) : icons.maximize({})}
              </button>
              <button
                type="button"
                className={c.iconBtn}
                onClick={() => setOpen(false)}
                aria-label="Close chat"
              >
                {icons.close({})}
              </button>
            </header>
            <label className={c.search}>
              {icons.search({})}
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search chats or people"
                aria-label="Search chats or people"
              />
            </label>
            <ul className={c.convs}>
              {shownChats.map((x) => (
                <li key={x.id}>
                  <button
                    type="button"
                    className={c.conv}
                    aria-current={x.id === activeId || undefined}
                    onClick={() => openChat(x.id)}
                  >
                    <ChatAvatar conv={x} size={44} />
                    <span className={c.convText}>
                      <span className={c.convTop}>
                        <b>{x.title}</b>
                        <small>{listTime(x.lastMessageAt)}</small>
                      </span>
                      <span className={c.convBottom}>
                        <span>{preview(x.lastMessage, user!.id, x.kind === 'GROUP')}</span>
                        {x.mentions > 0 && (
                          <span className={c.mention} title="You were mentioned">
                            @
                          </span>
                        )}
                        {x.unread > 0 && <span className={c.unread}>{x.unread}</span>}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
              {conversations.isSuccess && !list.length && !needle && (
                <li className={c.listHint}>No chats yet. Pick someone below, or start a group.</li>
              )}
              {shownPeople.length > 0 && (
                <>
                  <li className={c.listLabel}>People</li>
                  {shownPeople.map((u) => (
                    <li key={u.id}>
                      <button
                        type="button"
                        className={c.conv}
                        onClick={() => void startDirect(u.id)}
                      >
                        <Avatar name={u.fullName} src={u.avatarUrl} size={44} />
                        <span className={c.convText}>
                          <b>{u.fullName}</b>
                          <small className={c.muted}>Start a chat</small>
                        </span>
                      </button>
                    </li>
                  ))}
                </>
              )}
              {needle && !shownChats.length && !shownPeople.length && (
                <li className={c.listHint}>No chats or people match “{q}”.</li>
              )}
            </ul>
          </aside>

          <div className={c.main}>
            {mode === 'new' ? (
              <NewGroup onBack={() => setMode('chat')} onCreated={openChat} />
            ) : active && mode === 'info' ? (
              <GroupInfo
                conv={active}
                onBack={() => setMode('chat')}
                onLeft={() => {
                  setActiveId(null);
                  setMode('chat');
                }}
                onMessage={(id) => void startDirect(id)}
              />
            ) : active ? (
              <ChatView
                conv={active}
                active={open}
                onBack={() => setActiveId(null)}
                onInfo={() => setMode('info')}
              />
            ) : (
              <div className={c.placeholder}>
                {icons.chat({})}
                <p>Choose a chat, or start a new one.</p>
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
