import { api, ApiError } from '../../lib/api';
import type { Answer, ChatMessage } from './companionAnswers';

/** false once the server said it has no AI key (then the analysis answers are used without asking again) */
let aiAvailable = true;

/**
 * Ask the AI companion (Groq, via our server) about the repository; the server adds the file's source, its related
 * files and the analysis facts. Falls back to the analysis-only answer when AI is not configured or fails.
 */
export async function askWithAI(repoId: string, question: string, path: string | null, chat: ChatMessage[], context: string, fallback: () => Answer): Promise<Answer> {
  if (!aiAvailable || repoId === 'sample') return fallback();
  const history = chat.slice(-8).map((m) => ({ role: m.role === 'user' ? 'user' as const : 'assistant' as const, content: m.role === 'user' ? m.text ?? '' : m.answer?.text ?? [...(m.answer?.paragraphs ?? []), ...(m.answer?.bullets ?? [])].join('\n') }));
  try {
    const r = await api.askAssistant(repoId, { question, path, context, history });
    return { kind: 'ai', text: r.answer, usedFiles: r.usedFiles, paragraphs: [] };
  } catch (err) {
    if (err instanceof ApiError && err.status === 503) { aiAvailable = false; return fallback(); }
    const answer = fallback();
    return { ...answer, paragraphs: [`The AI could not answer (${err instanceof Error ? err.message : 'error'}). Here is what the analysis knows:`, ...answer.paragraphs] };
  }
}
