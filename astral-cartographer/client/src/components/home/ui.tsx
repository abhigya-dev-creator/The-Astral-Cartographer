import React from 'react';
import { AlertCircle, CheckCircle2, Info, RefreshCw, TriangleAlert } from 'lucide-react';
import { AnalysisStage, ISupportStatus, SupportStatusLevel } from '../../lib/api';
import { ANALYSIS_STAGES, DEFAULT_NA_REASON, formatNumber, isAvailable } from '../../lib/analysisFormat';

export type Tone = 'blue' | 'cyan' | 'violet' | 'orange' | 'red' | 'green' | 'amber' | 'muted';

export const TONES: Record<Tone, { fg: string; bg: string; border: string }> = {
  blue: { fg: '#6898FF', bg: 'rgba(56, 107, 255, 0.15)', border: 'rgba(100, 160, 255, 0.35)' },
  cyan: { fg: '#37D9FF', bg: 'rgba(55, 217, 255, 0.12)', border: 'rgba(55, 217, 255, 0.35)' },
  violet: { fg: '#A99AFF', bg: 'rgba(139, 120, 255, 0.15)', border: 'rgba(139, 120, 255, 0.35)' },
  orange: { fg: '#FFAD66', bg: 'rgba(255, 173, 102, 0.12)', border: 'rgba(255, 173, 102, 0.35)' },
  red: { fg: '#FF949C', bg: 'rgba(255, 113, 122, 0.12)', border: 'rgba(255, 113, 122, 0.35)' },
  green: { fg: '#70E8BA', bg: 'rgba(67, 217, 163, 0.12)', border: 'rgba(67, 217, 163, 0.35)' },
  amber: { fg: '#FFD166', bg: 'rgba(255, 209, 102, 0.1)', border: 'rgba(255, 209, 102, 0.35)' },
  muted: { fg: '#A7B4CC', bg: 'rgba(167, 180, 204, 0.08)', border: 'rgba(167, 180, 204, 0.22)' },
};

export const panelStyle: React.CSSProperties = {
  borderRadius: 16,
  background: 'rgba(7, 12, 27, 0.72)',
  border: '1px solid rgba(135, 155, 255, 0.22)',
  backdropFilter: 'blur(20px)',
  WebkitBackdropFilter: 'blur(20px)',
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
};

export const sectionLabelStyle: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: '1.5px',
  fontWeight: 600,
  color: '#8B78FF',
  textTransform: 'uppercase',
  margin: '0 0 10px',
};

export const monoStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  overflowWrap: 'anywhere',
};

export function GithubIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
      />
    </svg>
  );
}

export function Panel({
  title,
  action,
  children,
  style,
  id,
}: {
  title: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  style?: React.CSSProperties;
  id?: string;
}) {
  return (
    <section id={id} className="card" style={{ ...panelStyle, ...style }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 10,
          marginBottom: 16,
        }}
      >
        <h3 style={{ fontSize: 16, fontWeight: 600, color: '#F3F6FF', margin: 0 }}>{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Badge({ tone, children, title }: { tone: Tone; children: React.ReactNode; title?: string }) {
  const t = TONES[tone];
  return (
    <span
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 10,
        fontWeight: 500,
        lineHeight: 1.4,
        padding: '1px 7px',
        borderRadius: 999,
        color: t.fg,
        background: t.bg,
        border: `1px solid ${t.border}`,
        whiteSpace: 'nowrap',
        cursor: title ? 'help' : undefined,
      }}
    >
      {children}
    </span>
  );
}

/** Native-tooltip info icon; focusable so keyboard users can reach the description. */
export function InfoTip({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <span
      tabIndex={0}
      role="img"
      aria-label={text}
      title={text}
      style={{ display: 'inline-flex', color: '#77839C', cursor: 'help', verticalAlign: 'middle' }}
    >
      <Info size={12} />
    </span>
  );
}

export function Spinner({ size = 14, color }: { size?: number; color?: string }) {
  return <RefreshCw size={size} className="spin" color={color} style={{ flexShrink: 0 }} aria-hidden="true" />;
}

const NOTICE_ICONS = {
  red: AlertCircle,
  green: CheckCircle2,
  blue: Info,
  amber: TriangleAlert,
} as const;

export function Notice({
  tone,
  title,
  children,
  onClose,
  style,
}: {
  tone: keyof typeof NOTICE_ICONS;
  title?: React.ReactNode;
  children?: React.ReactNode;
  onClose?: () => void;
  style?: React.CSSProperties;
}) {
  const t = TONES[tone];
  const Icon = NOTICE_ICONS[tone];
  return (
    <div
      role={tone === 'red' ? 'alert' : 'status'}
      style={{
        background: t.bg,
        border: `1px solid ${t.border}`,
        borderRadius: 8,
        padding: '10px 14px',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        fontSize: 12,
        color: t.fg,
        ...style,
      }}
    >
      <Icon size={16} style={{ flexShrink: 0, marginTop: 1 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        {title && <div style={{ fontWeight: 600, marginBottom: children ? 2 : 0 }}>{title}</div>}
        {children && <div style={{ color: '#B8BBCB' }}>{children}</div>}
      </div>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Dismiss"
          style={{ background: 'none', border: 'none', color: t.fg, cursor: 'pointer', padding: 0 }}
        >
          ✕
        </button>
      )}
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon: React.ReactNode; title: string; children?: React.ReactNode }) {
  return (
    <div
      style={{
        padding: '32px 20px',
        textAlign: 'center',
        color: '#A7B4CC',
        background: 'rgba(4, 8, 19, 0.4)',
        borderRadius: 12,
        border: '1px dashed rgba(135, 155, 255, 0.18)',
        margin: 'auto 0',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10 }}>{icon}</div>
      <div style={{ fontSize: 14, fontWeight: 500, color: '#EAF0FF', marginBottom: 6 }}>{title}</div>
      {children && <div style={{ fontSize: 12, color: '#77839C', maxWidth: 340, margin: '0 auto' }}>{children}</div>}
    </div>
  );
}

function partialTooltip(support?: ISupportStatus): string {
  const langs = support?.partialLanguages?.length ? `${support.partialLanguages.join(', ')} use heuristic parsing. ` : '';
  return `Approximate: ${langs}${support?.reason || 'Some files could not be parsed with a full AST, so this count is approximate.'}`;
}

/**
 * Renders a metric following the N/A rules:
 * null/undefined -> "N/A" with the server's reason; a real 0 -> "0";
 * status 'partial' -> number plus an "approx." badge.
 */
export function MetricValue({
  value,
  status,
  support,
  naSize = 16,
}: {
  value: number | null | undefined;
  status?: SupportStatusLevel;
  support?: ISupportStatus;
  naSize?: number;
}) {
  if (!isAvailable(value)) {
    const reason = support?.reason || DEFAULT_NA_REASON;
    return (
      <span title={reason} aria-label={`Not available: ${reason}`} style={{ color: '#8898B0', fontSize: naSize, cursor: 'help' }}>
        N/A
      </span>
    );
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      {formatNumber(value)}
      {status === 'partial' && (
        <Badge tone="amber" title={partialTooltip(support)}>
          approx.
        </Badge>
      )}
    </span>
  );
}

export function PartialBadge({ support }: { support?: ISupportStatus }) {
  return (
    <Badge tone="amber" title={partialTooltip(support)}>
      partial
    </Badge>
  );
}

export function ConfidenceBadge({ confidence }: { confidence?: 'confirmed' | 'heuristic' }) {
  if (confidence === 'confirmed') {
    return (
      <Badge tone="green" title="Deterministic check: the finding follows directly from the code (e.g. an import cycle).">
        Confirmed
      </Badge>
    );
  }
  if (confidence === 'heuristic') {
    return (
      <Badge tone="amber" title="Threshold-based check: flagged because a measurement exceeded a limit. Review before acting.">
        Heuristic
      </Badge>
    );
  }
  return null;
}

/** Real staged progress driven by the server's `stage` field. */
export function StageProgress({ stage, message }: { stage: AnalysisStage | null | undefined; message?: string | null }) {
  const activeIndex = stage ? ANALYSIS_STAGES.findIndex((s) => s.id === stage) : -1;
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        background: 'rgba(56, 107, 255, 0.12)',
        border: '1px solid rgba(135, 155, 255, 0.3)',
        borderRadius: 8,
        padding: '10px 14px',
        fontSize: 12,
        color: '#B8BBCB',
      }}
    >
      {activeIndex >= 0 && (
        <ol
          style={{
            listStyle: 'none',
            margin: '0 0 8px',
            padding: 0,
            display: 'flex',
            flexWrap: 'wrap',
            gap: '6px 18px',
          }}
        >
          {ANALYSIS_STAGES.map((s, i) => {
            const done = i < activeIndex;
            const active = i === activeIndex;
            return (
              <li
                key={s.id}
                aria-current={active ? 'step' : undefined}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  color: active ? '#EAF0FF' : done ? '#70E8BA' : '#77839C',
                  fontWeight: active ? 600 : 400,
                }}
              >
                {done ? (
                  <CheckCircle2 size={13} />
                ) : active ? (
                  <Spinner size={13} color="#8B78FF" />
                ) : (
                  <span style={{ width: 7, height: 7, margin: 3, borderRadius: '50%', background: 'rgba(135, 155, 255, 0.3)' }} />
                )}
                {s.label}
              </li>
            );
          })}
        </ol>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {activeIndex < 0 && <Spinner color="#8B78FF" />}
        <span>{message || 'Waiting for status from the analysis server…'}</span>
      </div>
    </div>
  );
}
