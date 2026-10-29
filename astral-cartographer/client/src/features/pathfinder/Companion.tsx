import { useEffect, useRef, useState } from 'react';
import { Bot, Info, SendHorizontal, Sparkles } from 'lucide-react';
import { type Answer, type ChatMessage, type Suggestion } from './companionAnswers';

interface Props {
  title: string;
  intro: string;
  messages: ChatMessage[];
  suggestions: Suggestion[];
  onAsk: (q: { id?: string; text: string }) => void;
  onOpenFile: (path: string, line?: number) => void;
  placeholder: string;
  compact?: boolean;
}

/** Conversation panel. Answers come from the repository analysis; the panel says so and never imitates an AI. */
export default function Companion({ title, intro, messages, suggestions, onAsk, onOpenFile, placeholder, compact }: Props) {
  const [text, setText] = useState('');
  const log = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = log.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const send = () => {
    const q = text.trim();
    if (!q) return;
    onAsk({ text: q });
    setText('');
  };

  return (
    <section className={`pf-companion card${compact ? ' is-compact' : ''}`} aria-label={title}>
      <header className="pf-companion-head">
        <span className="pf-companion-icon" aria-hidden="true"><Bot size={18} /></span>
        <div style={{ minWidth: 0 }}>
          <h2 className="pf-h2">{title}</h2>
          <p className="pf-muted pf-small">{intro}</p>
        </div>
      </header>
      <p className="pf-companion-mode" role="note"><Info size={13} aria-hidden="true" /> Answers use AI (Groq) with the selected file, its related files and the analysis when the server has a GROQ_API_KEY; otherwise they come from the analysis only.</p>

      <div className="pf-suggestions" role="group" aria-label="Suggested questions">
        {suggestions.map((s) => (
          <button key={s.id} type="button" className="pf-suggestion" onClick={() => onAsk({ id: s.id, text: s.label })}>
            <Sparkles size={12} aria-hidden="true" /> {s.label}
          </button>
        ))}
      </div>

      <div className="pf-chat" ref={log} role="log" aria-live="polite" aria-label="Conversation">
        {messages.length === 0 && <p className="pf-muted pf-small pf-chat-empty">Choose a question above or type your own.</p>}
        {messages.map((m) => m.role === 'user'
          ? <div key={m.id} className="pf-msg is-user">{m.text}</div>
          : <AnswerView key={m.id} answer={m.answer!} onOpenFile={onOpenFile} />)}
      </div>

      <form className="pf-ask" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <input type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} aria-label={placeholder} maxLength={500} />
        <button type="submit" className="pf-send" disabled={!text.trim()} aria-label="Send question"><SendHorizontal size={16} /></button>
      </form>
    </section>
  );
}

function AnswerView({ answer, onOpenFile }: { answer: Answer; onOpenFile: (path: string, line?: number) => void }) {
  return (
    <div className={`pf-msg is-answer${answer.kind === 'limit' ? ' is-limit' : ''}`}>
      <span className="pf-msg-source">{answer.kind === 'ai' ? 'AI answer · check it against the code' : answer.kind === 'limit' ? 'Not available' : 'From the repository analysis · not AI-generated'}</span>
      {answer.kind === 'ai' && <AiText text={answer.text ?? ''} />}
      {answer.kind === 'ai' && !!answer.usedFiles?.length && (
        <div className="pf-msg-links">{answer.usedFiles.map((p) => <button key={p} type="button" className="pf-link-chip" onClick={() => onOpenFile(p)} title={`Open ${p}`}>{p.slice(p.lastIndexOf('/') + 1)}</button>)}</div>
      )}
      {answer.title && <strong className="pf-msg-title">{answer.title}</strong>}
      {answer.paragraphs.map((p, i) => <p key={i}>{p}</p>)}
      {answer.bullets && answer.bullets.length > 0 && <ul>{answer.bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>}
      {answer.links && answer.links.length > 0 && (
        <div className="pf-msg-links">
          {answer.links.map((l) => (
            <button key={`${l.path}:${l.line ?? ''}`} type="button" className="pf-link-chip" onClick={() => onOpenFile(l.path, l.line)} title={`Open ${l.path}${l.line ? ` at line ${l.line}` : ''}`}>
              {l.label}{l.line ? ` · L${l.line}` : ''}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Minimal Markdown for AI answers: code blocks, bullet lists and paragraphs (rendered as text, never as HTML). */
function AiText({ text }: { text: string }) {
  // odd parts are the insides of ``` code fences
  const blocks = text.split(/```[\w-]*\n?/);
  const bullet = /^\s*([-*]|\d+\.)\s+/;
  return (
    <>
      {blocks.map((b, i) => i % 2 === 1
        ? <pre key={i} className="pf-ai-code">{b.replace(/\n$/, '')}</pre>
        : b.split(/\n{2,}/).filter((p) => p.trim()).map((p, j) => bullet.test(p)
          ? <ul key={`${i}-${j}`}>{p.split('\n').filter((l) => l.trim()).map((l, k) => <li key={k}>{l.replace(bullet, '').replace(/\*\*/g, '')}</li>)}</ul>
          : <p key={`${i}-${j}`} style={{ whiteSpace: 'pre-wrap' }}>{p.replace(/\*\*/g, '')}</p>))}
    </>
  );
}
