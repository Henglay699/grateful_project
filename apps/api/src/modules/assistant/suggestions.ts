import { createHash } from 'node:crypto';
import { hasPermission, ROLE_LABEL, type Permission, type RoleCode } from '@gs/shared';
import { logger } from '../../lib/logger';
import { SYSTEM_GUIDE } from './guide';
import { provider } from './providers';

/*
 * Suggested questions for the Ask AI panel. They are written by the AI from the system guide,
 * for the page the user has open and what their role can do, so new features (added to the
 * guide) show up in the suggestions on their own. One list per page section and role is kept
 * for a day, or until the guide changes. Without an AI provider (or if it fails), a built-in
 * list is used, filtered the same way.
 */

interface Bank {
  q: string;
  /** Needs this permission. */
  perm?: Permission;
  /** Page sections it fits best (first path segment, or "accounting/<tab>"). */
  pages?: string[];
}

const BANK: Bank[] = [
  { q: 'How do I create a new shipment?', perm: 'shipments:write', pages: ['plans', 'overview'] },
  {
    q: 'How do I filter shipping plans by client and month?',
    perm: 'shipments:read',
    pages: ['plans'],
  },
  { q: 'How do I export the shipping plan to Excel?', perm: 'shipments:read', pages: ['plans'] },
  { q: 'Why does an export shipment have no ETA?', perm: 'shipments:read', pages: ['plans'] },
  {
    q: 'Can I save a shipment before filling the declaration?',
    perm: 'shipments:write',
    pages: ['plans'],
  },
  {
    q: 'How do I pick another month on the Overview?',
    perm: 'dashboard:read',
    pages: ['overview'],
  },
  {
    q: 'What does "Customs Cleared" count?',
    perm: 'dashboard:read',
    pages: ['overview', 'analytics'],
  },
  {
    q: 'How is a shipment counted in a month?',
    perm: 'dashboard:read',
    pages: ['overview', 'analytics'],
  },
  {
    q: 'Where can I see unpaid invoices?',
    perm: 'accounting:read',
    pages: ['accounting', 'accounting/billing'],
  },
  {
    q: "How do I bill a client's month?",
    perm: 'accounting:read',
    pages: ['accounting/billing', 'accounting'],
  },
  {
    q: 'How do I record a payment and print a receipt?',
    perm: 'accounting:write',
    pages: ['accounting/billing', 'accounting/receipts'],
  },
  {
    q: 'Can I print a receipt before the client pays?',
    perm: 'accounting:read',
    pages: ['accounting/billing', 'accounting/receipts'],
  },
  {
    q: 'What does "Cancel" do on a receipt?',
    perm: 'accounting:read',
    pages: ['accounting/receipts', 'accounting/billing'],
  },
  {
    q: 'How do I print the whole month pack?',
    perm: 'accounting:read',
    pages: ['accounting/billing'],
  },
  {
    q: 'How do I create drafts for every shipment at once?',
    perm: 'accounting:write',
    pages: ['accounting/billing'],
  },
  {
    q: 'How is net profit calculated in the Monthly Ledger?',
    perm: 'accounting:read',
    pages: ['accounting', 'overview'],
  },
  {
    q: 'How do I issue a tax invoice from a ledger row?',
    perm: 'accounting:write',
    pages: ['accounting', 'accounting/tax-invoices'],
  },
  {
    q: 'What is the difference between a disbursement and a debit note?',
    perm: 'accounting:read',
    pages: ['accounting/disbursements', 'accounting/debit-notes', 'accounting/billing'],
  },
  {
    q: 'How do I check a credit note from the broker?',
    perm: 'accounting:read',
    pages: ['accounting/credit-notes'],
  },
  {
    q: 'How do I create a Credit Noted voucher?',
    perm: 'creditnotes:write',
    pages: ['credit-noted'],
  },
  {
    q: 'What happens when I Submit to Monthly?',
    perm: 'creditnotes:write',
    pages: ['credit-noted'],
  },
  {
    q: 'How do I export all credit notes as one PDF or Excel?',
    perm: 'creditnotes:read',
    pages: ['credit-noted'],
  },
  {
    q: 'Where do I see remarks from accounting?',
    perm: 'creditnotes:read',
    pages: ['credit-noted'],
  },
  { q: 'How do I import a CDC master list?', perm: 'cutstock:read', pages: ['cutstock'] },
  {
    q: 'What happens if an import is over the CDC balance?',
    perm: 'cutstock:read',
    pages: ['cutstock', 'plans'],
  },
  { q: 'How do I add a new client?', perm: 'clients:write', pages: ['clients'] },
  {
    q: 'How do I upload a document to a shipment?',
    perm: 'documents:read',
    pages: ['documents', 'plans'],
  },
  { q: 'How do I make a quotation?', perm: 'quotations:read', pages: ['quotations'] },
  {
    q: 'Where are the fuel prices and exchange rates?',
    perm: 'settings:read',
    pages: ['settings'],
  },
  { q: 'How do I add a staff member and set their role?', perm: 'staff:read', pages: ['staff'] },
  { q: 'What does CY / CY mean?', pages: ['plans', 'analytics'] },
  { q: 'What is the difference between HBL and declare no.?' },
  { q: 'How do I change my password?' },
];

/** "/accounting/billing/abc" → "accounting/billing"; "/plans/123" → "plans". */
export function pageSection(page: string | undefined): string {
  const parts = (page ?? '').split('/').filter(Boolean);
  if (!parts.length) return 'overview';
  return parts[0] === 'accounting' && parts[1] ? `accounting/${parts[1]}` : parts[0]!;
}

function builtIn(section: string, perms: readonly string[]): string[] {
  const allowed = BANK.filter((b) => !b.perm || hasPermission(perms, b.perm));
  const top = section.split('/')[0]!;
  const here = allowed.filter((b) => b.pages?.some((p) => p === section || p === top));
  const rest = allowed.filter((b) => !here.includes(b));
  return [...here, ...rest].slice(0, 12).map((b) => b.q);
}

/** A list of questions out of the model's reply: one per line, trimmed, plausible. */
function parseQuestions(text: string, max: number): string[] {
  const seen = new Set<string>();
  return text
    .split('\n')
    .map((l) =>
      l
        .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '')
        .replace(/^["“]|["”]$/g, '')
        .trim(),
    )
    .filter((l) => l.length >= 8 && l.length <= 90 && l.endsWith('?'))
    .filter((l) => !seen.has(l.toLowerCase()) && seen.add(l.toLowerCase()))
    .slice(0, max);
}

/** Ask the model for a short reply, collected (not streamed); null when unavailable. */
async function complete(userContext: string, prompt: string): Promise<string | null> {
  if (!provider) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25_000);
  let out = '';
  try {
    const outcome = await provider({
      system: SYSTEM_GUIDE,
      userContext,
      messages: [{ role: 'user', content: prompt }],
      signal: ctrl.signal,
      onText: (t) => (out += t),
    });
    return outcome === 'done' ? out : null;
  } catch (err) {
    logger.warn({ err }, 'assistant suggestions failed');
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const GUIDE_HASH = createHash('sha1').update(SYSTEM_GUIDE).digest('hex').slice(0, 12);
const DAY = 24 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; guide: string; questions: string[] }>();
const inflight = new Map<string, Promise<string[]>>();

const context = (role: RoleCode, perms: readonly string[], page: string | undefined) =>
  [
    `The user's role is ${ROLE_LABEL[role]}.`,
    `Their permissions: ${perms.join(', ')}.`,
    page ? `They currently have ${page} open.` : '',
  ]
    .filter(Boolean)
    .join(' ');

/** Up to 12 questions for this page section and role (the panel shows a few at a time). */
export async function suggestions(
  role: RoleCode,
  perms: readonly string[],
  page: string | undefined,
): Promise<{ questions: string[]; source: 'ai' | 'built-in' }> {
  const section = pageSection(page);
  const key = `${role}|${[...perms].sort().join(',')}|${section}`;
  const hit = cache.get(key);
  if (hit && hit.guide === GUIDE_HASH && Date.now() - hit.at < DAY)
    return { questions: hit.questions, source: 'ai' };

  let job = inflight.get(key);
  if (!job) {
    job = (async () => {
      const text = await complete(
        context(role, perms, `/${section}`),
        `List 12 short, varied questions this user might ask you about using the system, most of them about the page they have open (/${section}) and the newest features in your guide, the rest about other things their permissions allow. Only features in your guide that their permissions allow. Each question under 70 characters, in plain English, ending with "?". One per line, nothing else: no numbering, no intro.`,
      );
      const questions = text ? parseQuestions(text, 12) : [];
      if (questions.length >= 4) cache.set(key, { at: Date.now(), guide: GUIDE_HASH, questions });
      return questions;
    })().finally(() => inflight.delete(key));
    inflight.set(key, job);
  }
  const questions = await job;
  return questions.length >= 4
    ? { questions, source: 'ai' }
    : { questions: builtIn(section, perms), source: 'built-in' };
}

/** Three follow-up questions after an answer; empty when the AI can't suggest any. */
export async function followUps(
  role: RoleCode,
  perms: readonly string[],
  page: string | undefined,
  question: string,
  answer: string,
): Promise<string[]> {
  const text = await complete(
    context(role, perms, page),
    `The user asked: "${question.slice(0, 500)}"\nYou answered: "${answer.slice(0, 1500)}"\n\nSuggest 3 short follow-up questions they are likely to ask next about this, only about features in your guide that their permissions allow. Each under 70 characters, ending with "?". One per line, nothing else.`,
  );
  return text ? parseQuestions(text, 3) : [];
}
