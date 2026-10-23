import { useState } from 'react';
import { AlertCircle, Info, TriangleAlert } from 'lucide-react';
import { AnalysisDetails, IArchitecturalIssue, ICoverageRule } from '../../lib/api';
import { formatNumber, humanizeKey, isAvailable } from '../../lib/analysisFormat';
import { Badge, ConfidenceBadge, Notice, Panel, Spinner, TONES, monoStyle, sectionLabelStyle } from './ui';

const SEVERITIES = [
  { id: 'error', label: 'Errors', tone: 'red', Icon: AlertCircle },
  { id: 'warning', label: 'Warnings', tone: 'orange', Icon: TriangleAlert },
  { id: 'info', label: 'Info', tone: 'blue', Icon: Info },
] as const;

const PAGE_SIZE = 20;
const AFFECTED_PREVIEW = 5;

function IssueItem({ issue }: { issue: IArchitecturalIssue }) {
  const affected = (issue.affectedFiles ?? []).filter((f) => f !== issue.file);
  return (
    <li
      style={{
        padding: '10px 12px',
        borderRadius: 10,
        background: 'rgba(4, 8, 19, 0.45)',
        border: '1px solid rgba(135, 155, 255, 0.1)',
        display: 'flex',
        flexDirection: 'column',
        gap: 5,
        minWidth: 0,
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#EAF0FF' }}>{issue.rule}</span>
        <ConfidenceBadge confidence={issue.confidence} />
      </div>
      <div style={{ ...monoStyle, color: '#A99AFF' }}>
        {issue.file}
        {isAvailable(issue.line) && `:${issue.line}`}
      </div>
      <div style={{ fontSize: 12, color: '#B8BBCB' }}>{issue.description}</div>
      {affected.length > 0 && (
        <details>
          <summary style={{ cursor: 'pointer', fontSize: 11, color: '#8898B0' }}>
            Affects {affected.length} other file{affected.length === 1 ? '' : 's'}
          </summary>
          <ul style={{ margin: '4px 0 0', paddingLeft: 16, ...monoStyle, color: '#A7B4CC' }}>
            {affected.slice(0, AFFECTED_PREVIEW).map((f) => (
              <li key={f}>{f}</li>
            ))}
            {affected.length > AFFECTED_PREVIEW && <li style={{ listStyle: 'none' }}>+{affected.length - AFFECTED_PREVIEW} more</li>}
          </ul>
        </details>
      )}
    </li>
  );
}

function SeverityGroup({ severity, issues }: { severity: (typeof SEVERITIES)[number]; issues: IArchitecturalIssue[] }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? issues : issues.slice(0, PAGE_SIZE);
  const t = TONES[severity.tone];
  return (
    <details open={severity.id !== 'info'} style={{ marginBottom: 12 }}>
      <summary style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: t.fg, marginBottom: 8 }}>
        <severity.Icon size={14} />
        {severity.label} ({formatNumber(issues.length)})
      </summary>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {shown.map((issue, i) => (
          <IssueItem key={issue.id ?? `${issue.rule}-${issue.file}-${issue.line ?? ''}-${i}`} issue={issue} />
        ))}
      </ul>
      {issues.length > PAGE_SIZE && (
        <button type="button" className="auth-link" style={{ marginTop: 8 }} onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'Show fewer' : `Show all ${formatNumber(issues.length)}`}
        </button>
      )}
    </details>
  );
}

function RuleRow({ rule }: { rule: ICoverageRule }) {
  const skipped = Object.entries(rule.skipped ?? {}).filter(([, n]) => n > 0);
  return (
    <li style={{ padding: '8px 0', borderBottom: '1px solid rgba(135, 155, 255, 0.08)', fontSize: 12 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        <span style={{ color: '#EAF0FF', fontWeight: 500 }}>{rule.rule}</span>
        <ConfidenceBadge confidence={rule.confidence} />
      </div>
      <div style={{ color: rule.findings > 0 ? '#FFAD66' : '#A7B4CC', marginTop: 2 }}>
        {formatNumber(rule.findings)} finding{rule.findings === 1 ? '' : 's'} across {formatNumber(rule.eligibleFiles)} eligible file
        {rule.eligibleFiles === 1 ? '' : 's'}
        {isAvailable(rule.incompleteFiles) && rule.incompleteFiles > 0 && (
          <span style={{ color: '#FFD166' }}> · {formatNumber(rule.incompleteFiles)} incomplete</span>
        )}
      </div>
      {rule.basis && <div style={{ color: '#77839C', fontSize: 11 }}>{rule.basis}</div>}
      {skipped.length > 0 && (
        <div style={{ color: '#77839C', fontSize: 11 }}>
          Skipped: {skipped.map(([reason, n]) => `${humanizeKey(reason)} (${formatNumber(n)})`).join(', ')}
        </div>
      )}
    </li>
  );
}

interface ArchitecturalHealthProps {
  analysis: AnalysisDetails | null;
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
}

export default function ArchitecturalHealth({ analysis, isLoading, error, onRetry }: ArchitecturalHealthProps) {
  const issues = analysis?.issues ?? [];
  const rules = analysis?.metrics.coverage?.rules;
  const confirmed = issues.filter((i) => i.confidence === 'confirmed').length;
  const heuristic = issues.filter((i) => i.confidence === 'heuristic').length;

  return (
    <Panel
      title="Architectural Health"
      style={{ gridColumn: '1 / -1' }}
      action={
        analysis && issues.length > 0 ? (
          <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
            <Badge tone="green">{confirmed} confirmed</Badge>
            <Badge tone="amber">{heuristic} heuristic</Badge>
          </span>
        ) : undefined
      }
    >
      {error ? (
        <Notice tone="red" title="Could not load findings">
          {error}{' '}
          <button type="button" className="auth-link" onClick={onRetry}>
            Retry
          </button>
        </Notice>
      ) : isLoading && !analysis ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#77839C', fontSize: 12, padding: '12px 0' }}>
          <Spinner /> Loading findings…
        </div>
      ) : !analysis ? null : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 24 }}>
          <div style={{ minWidth: 0 }}>
            <h4 style={sectionLabelStyle}>Findings</h4>
            {issues.length === 0 ? (
              <div style={{ fontSize: 12, color: '#A7B4CC' }}>
                {rules && rules.length > 0
                  ? `0 findings across ${formatNumber(Math.max(...rules.map((r) => r.eligibleFiles)))} eligible files from ${rules.length} check${
                      rules.length === 1 ? '' : 's'
                    }. Each check's eligible files and skipped reasons are listed under “Checks that ran”.`
                  : '0 findings. The analyzer did not report which checks ran, so this does not confirm the codebase is healthy.'}
              </div>
            ) : (
              SEVERITIES.map((s) => {
                const group = issues.filter((i) => i.severity === s.id);
                return group.length > 0 ? <SeverityGroup key={s.id} severity={s} issues={group} /> : null;
              })
            )}
          </div>

          <div style={{ minWidth: 0 }}>
            <h4 style={sectionLabelStyle}>Checks that ran</h4>
            {rules && rules.length > 0 ? (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {rules.map((r) => (
                  <RuleRow key={`${r.type}-${r.rule}`} rule={r} />
                ))}
              </ul>
            ) : (
              <div style={{ fontSize: 12, color: '#77839C' }}>Check coverage was not reported for this analysis.</div>
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}
