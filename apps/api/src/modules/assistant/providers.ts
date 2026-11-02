import Anthropic from '@anthropic-ai/sdk';
import { ApiError as GeminiApiError, GoogleGenAI } from '@google/genai';
import { env } from '../../config/env';
import type { Attachment } from './attachments';

export interface ChatInput {
  system: string;
  /** Per-request context (role, permissions, page) — kept apart so the system prompt caches. */
  userContext: string;
  messages: { role: 'user' | 'assistant'; content: string; attachments?: Attachment[] }[];
  signal: AbortSignal;
  onText: (text: string) => void;
}
/** 'refused' when the model declined to answer. */
export type ChatOutcome = 'done' | 'refused';
type Provider = (input: ChatInput) => Promise<ChatOutcome>;

/** An error whose message is safe to show to the user. */
export class AssistantError extends Error {}

/** A Word / Excel file's extracted text, labelled so the model knows which file it is. */
const fileText = (a: Extract<Attachment, { kind: 'text' }>) =>
  `Attached file "${a.name}" (its text content):
<file name="${a.name}">
${a.text}
</file>`;

const BUSY = 'The assistant is busy or has reached its usage limit. Wait a moment and try again.';
const badKey = (name: string) =>
  `The AI assistant key is invalid. Ask an administrator to check ${name} in the server .env.`;

function anthropicProvider(apiKey: string): Provider {
  const client = new Anthropic({ apiKey });
  return async ({ system, userContext, messages, signal, onText }) => {
    const stream = client.beta.messages.stream(
      {
        model: env.ANTHROPIC_MODEL,
        max_tokens: 4000,
        output_config: { effort: 'low' },
        // On a safety decline, the API retries on a fallback model inside the same call.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: [
          { type: 'text', text: system, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: userContext },
        ],
        messages: messages.map((m) =>
          m.attachments?.length
            ? {
                role: m.role,
                content: [
                  ...m.attachments.map((a) =>
                    a.kind === 'image'
                      ? {
                          type: 'image' as const,
                          source: {
                            type: 'base64' as const,
                            media_type: a.mimeType as 'image/png',
                            data: a.data.toString('base64'),
                          },
                        }
                      : a.kind === 'pdf'
                        ? {
                            type: 'document' as const,
                            title: a.name,
                            source: {
                              type: 'base64' as const,
                              media_type: 'application/pdf' as const,
                              data: a.data.toString('base64'),
                            },
                          }
                        : { type: 'text' as const, text: fileText(a) },
                  ),
                  { type: 'text' as const, text: m.content },
                ],
              }
            : { role: m.role, content: m.content },
        ),
      },
      { signal },
    );
    stream.on('text', onText);
    try {
      const final = await stream.finalMessage();
      return final.stop_reason === 'refusal' ? 'refused' : 'done';
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError) throw new AssistantError(BUSY);
      if (err instanceof Anthropic.AuthenticationError)
        throw new AssistantError(badKey('ANTHROPIC_API_KEY'));
      throw err;
    }
  };
}

/** Google's "high demand" / transient server errors, worth retrying. */
const isOverloaded = (err: unknown) =>
  err instanceof GeminiApiError && (err.status === 500 || err.status === 503 || err.status === 504);

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => (clearTimeout(t), resolve()), { once: true });
  });

function geminiProvider(apiKey: string): Provider {
  const ai = new GoogleGenAI({ apiKey });
  // The free tier often answers 503 "high demand": retry, then fall back to the other model.
  const attempts = [
    { model: env.GEMINI_MODEL, delay: 0 },
    { model: env.GEMINI_MODEL, delay: 1000 },
    { model: env.GEMINI_FALLBACK_MODEL, delay: 500 },
    { model: env.GEMINI_FALLBACK_MODEL, delay: 2000 },
  ];
  return async ({ system, userContext, messages, signal, onText }) => {
    const contents = messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [
        ...(m.attachments ?? []).map((a) =>
          a.kind === 'text'
            ? { text: fileText(a) }
            : { inlineData: { mimeType: a.mimeType, data: a.data.toString('base64') } },
        ),
        { text: m.content },
      ],
    }));
    for (let i = 0; ; i++) {
      const { model, delay } = attempts[i]!;
      if (delay) await sleep(delay, signal);
      let sentText = false;
      try {
        const stream = await ai.models.generateContentStream({
          model,
          contents,
          config: {
            systemInstruction: `${system}\n\n${userContext}`,
            maxOutputTokens: 4000,
            abortSignal: signal,
          },
        });
        let blocked = false;
        for await (const chunk of stream) {
          if (chunk.promptFeedback?.blockReason) blocked = true;
          const text = chunk.text;
          if (text) {
            sentText = true;
            onText(text);
          }
        }
        return blocked ? 'refused' : 'done';
      } catch (err) {
        // Retry only before any text reached the user, so answers are never duplicated.
        if (isOverloaded(err) && !sentText && !signal.aborted && i < attempts.length - 1) continue;
        if (isOverloaded(err))
          throw new AssistantError(
            'The free AI service is overloaded right now. Wait a few seconds and press Retry.',
          );
        if (err instanceof GeminiApiError) {
          if (err.status === 429) throw new AssistantError(BUSY);
          if (err.status === 400 || err.status === 401 || err.status === 403)
            throw new AssistantError(badKey('GEMINI_API_KEY'));
        }
        throw err;
      }
    }
  };
}

/** The provider chosen by AI_PROVIDER, or the first one with a key; null when none is set up. */
function pickProvider(): Provider | null {
  const choice =
    env.AI_PROVIDER ?? (env.ANTHROPIC_API_KEY ? 'anthropic' : env.GEMINI_API_KEY ? 'gemini' : null);
  if (choice === 'anthropic' && env.ANTHROPIC_API_KEY)
    return anthropicProvider(env.ANTHROPIC_API_KEY);
  if (choice === 'gemini' && env.GEMINI_API_KEY) return geminiProvider(env.GEMINI_API_KEY);
  return null;
}

export const provider = pickProvider();
