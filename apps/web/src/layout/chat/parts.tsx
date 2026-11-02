import { useMemo, useState } from 'react';
import type { ChatConversationRow, ChatMessageRow, ChatUser } from '@gs/shared';
import { Avatar } from '../../components/Avatar';
import { useAuthedImage } from '../../lib/chat';
import { icons } from '../icons';
import c from './Chat.module.css';

/** Group photo (fetched with the token), the other person's picture, or initials. */
export function ChatAvatar({
  conv,
  size = 40,
}: {
  conv: Pick<
    ChatConversationRow,
    'id' | 'kind' | 'title' | 'hasPhoto' | 'photoVersion' | 'avatarUrl'
  >;
  size?: number;
}) {
  const group = conv.kind === 'GROUP';
  const photo = useAuthedImage(
    group && conv.hasPhoto ? `/chat/conversations/${conv.id}/photo` : null,
    conv.photoVersion,
  );
  return <Avatar name={conv.title} src={group ? photo : conv.avatarUrl} size={size} />;
}

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

/** "14:05" today, "Mon" this week, else "12 Oct". */
export function listTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (sameDay(d, now)) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (now.getTime() - d.getTime() < 6 * 86_400_000)
    return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

export const msgTime = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** Day separator: "Today", "Yesterday" or "Monday, 12 October 2026". */
export function dayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (sameDay(d, now)) return 'Today';
  if (sameDay(d, new Date(now.getTime() - 86_400_000))) return 'Yesterday';
  return d.toLocaleDateString([], {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/** One-line preview of a message for the chat list. */
export function preview(m: ChatMessageRow | null, myId: string, group: boolean): string {
  if (!m) return 'No messages yet';
  if (m.kind === 'SYSTEM') return m.body;
  const who = m.senderId === myId ? 'You: ' : group ? `${m.senderName?.split(' ')[0] ?? ''}: ` : '';
  if (m.deleted) return `${who}Message deleted`;
  if (m.kind === 'STICKER') return `${who}${m.body} Sticker`;
  if (m.kind === 'FILE') return `${who}📎 ${m.body || m.fileName}`;
  return who + m.body;
}

/** Search box + checkbox list of people, for new groups and adding members. */
export function MemberPicker({
  users,
  selected,
  onToggle,
}: {
  users: ChatUser[];
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  const [q, setQ] = useState('');
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? users.filter((u) => u.fullName.toLowerCase().includes(needle)) : users;
  }, [users, q]);
  return (
    <div className={c.picker}>
      <label className={c.search}>
        {icons.search({})}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search people"
          aria-label="Search people"
        />
      </label>
      <ul className={c.pickList}>
        {shown.map((u) => (
          <li key={u.id}>
            <label className={c.pickRow}>
              <input type="checkbox" checked={selected.has(u.id)} onChange={() => onToggle(u.id)} />
              <Avatar name={u.fullName} src={u.avatarUrl} size={32} />
              <span>{u.fullName}</span>
            </label>
          </li>
        ))}
        {!shown.length && <li className={c.muted}>No one matches “{q}”.</li>}
      </ul>
    </div>
  );
}
