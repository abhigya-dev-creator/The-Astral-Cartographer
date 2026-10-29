import { Router, Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import axios from 'axios';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth.js';
import { Repository } from '../models/Repository.js';
import { Analysis } from '../models/Analysis.js';
import { atlasStore } from '../services/atlas/gridfsStore.js';
import type { AtlasData } from '../services/atlas/types.js';

/**
 * POST /api/repositories/:id/assistant  { question, path?, history?, context? }
 * Answers questions about the repository with Groq (OpenAI-compatible API), grounded in the analysis:
 * repository structure, the selected file's source, the files it imports and the files that use them,
 * and architectural findings. Needs GROQ_API_KEY (optional GROQ_MODEL) in server/.env; otherwise 503 AI_NOT_CONFIGURED.
 */
const router = Router();
const wrap = (fn: (req: AuthenticatedRequest, res: Response) => Promise<any>) => (req: Request, res: Response, next: NextFunction) => fn(req as AuthenticatedRequest, res).catch(next);

const LIMITS = { QUESTION: 2000, HISTORY: 8, MAIN_SOURCE: 14000, RELATED_SOURCE: 3500, RELATED_FILES: 4, CONTEXT: 4000 };
const cache = new Map<string, AtlasData>();

async function loadSource(owner: string, name: string, sha: string, path: string, max: number): Promise<string | null> {
  if (!/^[0-9a-f]{40}$/i.test(sha)) return null;
  try {
    const url = `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/${sha}/${path.split('/').map(encodeURIComponent).join('/')}`;
    const { data } = await axios.get(url, { timeout: 8000, responseType: 'text', maxContentLength: 1024 * 1024, transformResponse: (x) => x });
    const text = String(data);
    return text.length > max ? `${text.slice(0, max)}\n… (truncated, ${text.length} characters in total)` : text;
  } catch {
    return null;
  }
}

router.post('/:id/assistant', requireAuth, wrap(async (req, res) => {
  const key = process.env.GROQ_API_KEY;
  if (!key) return res.status(503).json({ error: 'The AI assistant is not configured on the server (set GROQ_API_KEY in server/.env).', code: 'AI_NOT_CONFIGURED' });
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ error: 'Invalid repository id.' });
  const question = typeof req.body?.question === 'string' ? req.body.question.trim().slice(0, LIMITS.QUESTION) : '';
  if (!question) return res.status(400).json({ error: 'Ask a question.' });

  const repo = await Repository.findOne({ _id: req.params.id, userId: req.user!.id }).lean();
  if (!repo) return res.status(404).json({ error: 'Repository not found or access denied.' });
  const analysis: any = await Analysis.findOne(repo.latestAnalysisId ? { _id: repo.latestAnalysisId } : { repositoryId: repo._id, status: 'completed' }).sort({ createdAt: -1 }).select('atlas issues commitSha metrics.totalFiles').lean();
  if (!analysis?.atlas?.key) return res.status(404).json({ error: 'Analyze the repository first.' });
  let atlas = cache.get(analysis.atlas.key);
  if (!atlas) {
    atlas = (await atlasStore.load(analysis.atlas.key)) ?? undefined;
    if (!atlas) return res.status(404).json({ error: 'No dependency map is stored for this analysis. Re-analyze the repository.' });
    cache.set(analysis.atlas.key, atlas);
    if (cache.size > 20) cache.delete(cache.keys().next().value as string);
  }

  // ---- context ----
  const imports = new Map<string, Set<string>>(), users = new Map<string, Set<string>>();
  for (const e of atlas.edges) if (e.to) { (imports.get(e.from) ?? imports.set(e.from, new Set()).get(e.from)!).add(e.to); (users.get(e.to) ?? users.set(e.to, new Set()).get(e.to)!).add(e.from); }
  const folders = new Map<string, number>();
  for (const f of atlas.files) { const top = f.path.split('/').slice(0, 2).join('/'); folders.set(top, (folders.get(top) ?? 0) + 1); }
  const parts: string[] = [
    `Repository: ${repo.fullName} (${atlas.files.length} files, commit ${String(analysis.commitSha ?? '').slice(0, 7)}).`,
    `Main folders: ${[...folders].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([d, n]) => `${d} (${n})`).join(', ')}.`,
    `Most imported files: ${atlas.files.map((f) => [f.path, users.get(f.path)?.size ?? 0] as const).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([p, n]) => `${p} (${n})`).join(', ')}.`,
  ];
  const path = typeof req.body?.path === 'string' ? req.body.path : null;
  const file = path ? atlas.files.find((f) => f.path === path) : undefined;
  if (file) {
    const imp = [...(imports.get(file.path) ?? [])], usedBy = [...(users.get(file.path) ?? [])];
    const findings = (analysis.issues ?? []).filter((i: any) => i.file === file.path || (i.affectedFiles ?? []).includes(file.path));
    parts.push(`\nSELECTED FILE: ${file.path} (${file.lines} lines).`,
      `Declares: ${file.functions.map((f) => `${f.name} (line ${f.line})`).slice(0, 40).join(', ') || 'nothing detected'}.`,
      `Imports local files: ${imp.join(', ') || 'none'}.`, `Imported by: ${usedBy.join(', ') || 'no file'}.`,
      `Architectural findings: ${findings.map((i: any) => `${i.rule}: ${i.description}`).join(' | ') || 'none'}.`);
    if (repo.source === 'github') {
      const main = await loadSource(repo.owner, repo.name, analysis.commitSha, file.path, LIMITS.MAIN_SOURCE);
      if (main) parts.push(`\nSOURCE OF ${file.path}:\n\`\`\`\n${main}\n\`\`\``);
      for (const rel of [...imp, ...usedBy].slice(0, LIMITS.RELATED_FILES)) {
        const src = await loadSource(repo.owner, repo.name, analysis.commitSha, rel, LIMITS.RELATED_SOURCE);
        if (src) parts.push(`\nRELATED FILE ${rel} (${imp.includes(rel) ? 'imported by the selected file' : 'imports the selected file'}):\n\`\`\`\n${src}\n\`\`\``);
      }
    } else parts.push('(ZIP upload: source code is not available to the assistant.)');
  }
  const extra = typeof req.body?.context === 'string' ? req.body.context.slice(0, LIMITS.CONTEXT) : '';
  if (extra) parts.push(`\nCONTEXT FROM THE PAGE:\n${extra}`);

  const history = (Array.isArray(req.body?.history) ? req.body.history : []).slice(-LIMITS.HISTORY)
    .filter((m: any) => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string')
    .map((m: any) => ({ role: m.role, content: m.content.slice(0, 3000) }));

  const system = [
    'You are the coding companion of The Astral Cartographer. You help developers understand an unfamiliar repository and make changes to it.',
    'Use the repository context below. Refer to real file paths and line numbers. If the context does not contain what is needed, say so and suggest which file to open; never invent files, functions or behaviour.',
    'When asked how to make a change, give concrete steps: which files to edit, what to add or change (short code snippets are welcome), and how to test it.',
    'Explain simply for beginners. Be concise. Use Markdown lists and code blocks where helpful.',
    '', 'REPOSITORY CONTEXT:', parts.join('\n'),
  ].join('\n');

  try {
    const { data } = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
      model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
      messages: [{ role: 'system', content: system }, ...history, { role: 'user', content: question }],
      temperature: 0.2, max_tokens: 1500,
    }, { headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, timeout: 60_000 });
    const answer = data?.choices?.[0]?.message?.content;
    if (!answer) return res.status(502).json({ error: 'The AI service returned an empty answer.' });
    return res.json({ answer, model: data.model, usedFiles: file ? [file.path, ...[...(imports.get(file.path) ?? []), ...(users.get(file.path) ?? [])].slice(0, LIMITS.RELATED_FILES)] : [] });
  } catch (err: any) {
    const status = err?.response?.status;
    return res.status(502).json({ error: status === 429 ? 'The AI service rate limit was reached. Wait a minute and try again.' : status === 401 ? 'The GROQ_API_KEY was rejected. Check it in server/.env.' : 'The AI service could not be reached. Try again.' });
  }
}));

export default router;
