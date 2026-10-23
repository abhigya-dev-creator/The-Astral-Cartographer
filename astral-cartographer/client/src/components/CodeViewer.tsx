import { useEffect, useMemo, useRef, useState } from 'react';
import { languageOf, tokenize, type TokenClass } from '../lib/highlight';

/** Read-only, virtualised code view with line numbers and JS/TS/JSX syntax colours. Shared component. */
const COLORS: Record<TokenClass, string> = {
  plain: '#EAF0FF',
  comment: '#77839C',
  string: '#70E8BA',
  number: '#FFAD66',
  keyword: '#A99AFF',
  regex: '#37D9FF',
  tag: '#6898FF',
  attr: '#FFD166',
  type: '#37D9FF',
  fn: '#8EB5FF',
  punct: '#A7B4CC',
};

const LINE_H = 19;
const OVERSCAN = 30;

interface CodeViewerProps {
  code: string;
  path: string;
  /** line to scroll to and highlight; `nonce` lets the same line be requested again */
  target?: { line: number; nonce: number } | null;
  label?: string;
}

export default function CodeViewer({ code, path, target, label }: CodeViewerProps) {
  const lines = useMemo(() => tokenize(code, languageOf(path)), [code, path]);
  const ref = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(400);
  const [highlight, setHighlight] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // reset first, then apply the target (effects run in order), so a target that arrives with new code survives
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = 0;
    setScrollTop(0);
    setHighlight(null);
  }, [code]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !target) return;
    const line = Math.min(Math.max(1, target.line), lines.length);
    el.scrollTop = Math.max(0, (line - 1) * LINE_H - el.clientHeight / 3);
    setScrollTop(el.scrollTop);
    setHighlight(line);
  }, [target, lines]);

  const first = Math.max(0, Math.floor(scrollTop / LINE_H) - OVERSCAN);
  const last = Math.min(lines.length, Math.ceil((scrollTop + height) / LINE_H) + OVERSCAN);
  const gutter = String(lines.length).length;

  return (
    <div
      ref={ref}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      tabIndex={0}
      role="region"
      aria-label={label ?? `Source of ${path}`}
      style={{
        position: 'relative', height: '100%', overflow: 'auto', background: 'rgba(3, 7, 18, 0.72)',
        border: '1px solid rgba(135, 155, 255, 0.16)', borderRadius: 10, font: '12px/19px var(--font-mono)',
      }}
    >
      <div style={{ height: lines.length * LINE_H, position: 'relative', minWidth: 'max-content' }}>
        <div style={{ position: 'absolute', top: first * LINE_H, left: 0, right: 0 }}>
          {lines.slice(first, last).map((tokens, i) => {
            const n = first + i + 1;
            const on = n === highlight;
            return (
              <div key={n} style={{ display: 'flex', height: LINE_H, whiteSpace: 'pre', background: on ? 'rgba(56, 107, 255, 0.22)' : undefined, boxShadow: on ? 'inset 3px 0 0 #6898FF' : undefined }}>
                <span aria-hidden="true" style={{ position: 'sticky', left: 0, flexShrink: 0, width: `${gutter + 2}ch`, paddingRight: '1ch', textAlign: 'right', color: on ? '#EAF0FF' : '#4E5B78', background: 'rgba(3, 7, 18, 0.95)', userSelect: 'none' }}>
                  {n}
                </span>
                <span style={{ paddingLeft: '1ch', paddingRight: '2ch' }}>
                  {tokens.map((t, j) => (
                    <span key={j} style={{ color: COLORS[t.c], fontStyle: t.c === 'comment' ? 'italic' : undefined }}>{t.v}</span>
                  ))}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
