import { AnalysisSummary, LanguageLevel } from '../../lib/api';
import { formatNumber, getLanguageColor, humanizeKey, isAvailable } from '../../lib/analysisFormat';
import { Badge, Panel, monoStyle, sectionLabelStyle } from './ui';

type Level = LanguageLevel | 'n/a';

const LEVEL_BADGES: Record<Level, { tone: 'green' | 'amber' | 'muted'; text: string; title: string }> = {
  full: { tone: 'green', text: 'Full · AST', title: 'Parsed with a full syntax tree: functions and imports are exact.' },
  partial: { tone: 'amber', text: 'Partial · heuristic', title: 'Parsed with pattern matching: counts are approximate.' },
  unsupported: { tone: 'muted', text: 'Unsupported · N/A', title: 'Not parsed: functions and dependencies are N/A for these files.' },
  'n/a': { tone: 'muted', text: 'Not code', title: 'Markup, config or data files: no functions or imports to count.' },
};

interface Row {
  name: string;
  files: number;
  lines?: number;
  percentage?: number;
  level?: Level;
}

function buildRows(analysis: AnalysisSummary): Row[] {
  const support = analysis.metrics.supportStatus;
  const byName = new Map((support?.languages ?? []).map((l) => [l.name, l]));
  const levelFromLists = (name: string): Level | undefined => {
    if (support?.supportedLanguages?.includes(name)) return 'full';
    if (support?.partialLanguages?.includes(name)) return 'partial';
    if (support?.unsupportedLanguages?.includes(name)) return 'unsupported';
    return undefined;
  };

  const rows: Row[] = (analysis.languages ?? []).map((l) => {
    const s = byName.get(l.name);
    byName.delete(l.name);
    return {
      name: l.name,
      files: l.count,
      lines: l.lines ?? s?.lines,
      percentage: l.percentage,
      level: s?.level ?? l.support ?? levelFromLists(l.name),
    };
  });
  // Languages reported only by supportStatus
  for (const s of byName.values()) {
    rows.push({ name: s.name, files: s.files, lines: s.lines, level: s.level });
  }
  return rows.sort((a, b) => b.files - a.files);
}

/**
 * The server rounds percentages so they sum to 100, which can turn two equal tiny shares into
 * "0%" and "1%". Show "<1%" for any non-zero share below 1% instead.
 */
function formatShare(row: Row, totalFiles: number): string | null {
  if (!isAvailable(row.percentage)) return null;
  const exact = totalFiles > 0 ? (row.files / totalFiles) * 100 : row.percentage;
  return exact > 0 && exact < 1 ? '<1%' : `${row.percentage}%`;
}

export default function LanguageSupport({ analysis }: { analysis: AnalysisSummary }) {
  const rows = buildRows(analysis);
  const totalFiles = (analysis.languages ?? []).reduce((sum, l) => sum + l.count, 0);
  const coverage = analysis.metrics.coverage;
  const excluded = Object.entries(coverage?.excluded ?? {}).filter(([, n]) => n > 0);
  const excludedDirs = coverage?.excludedDirectories ?? [];
  const parseCounts = Object.entries(coverage?.parseStatusCounts ?? {}).filter(([, n]) => n > 0);
  const levelCounts = rows.reduce<Record<string, number>>((acc, r) => {
    if (r.level) acc[r.level] = (acc[r.level] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <Panel title="Language Support">
      {Object.keys(levelCounts).length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
          {(['full', 'partial', 'unsupported'] as const).map((lvl) =>
            levelCounts[lvl] ? (
              <Badge key={lvl} tone={LEVEL_BADGES[lvl].tone} title={LEVEL_BADGES[lvl].title}>
                {LEVEL_BADGES[lvl].text}: {levelCounts[lvl]}
              </Badge>
            ) : null
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <div style={{ fontSize: 12, color: '#77839C', marginBottom: 16 }}>No languages were detected.</div>
      ) : (
        <ul style={{ listStyle: 'none', margin: '0 0 18px', padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rows.map((r) => {
            const badge = r.level ? LEVEL_BADGES[r.level] : null;
            return (
              <li key={r.name} style={{ fontSize: 12 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 8px', marginBottom: 4 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: getLanguageColor(r.name) }} />
                  <span style={{ color: '#EAF0FF', fontWeight: 500 }}>{r.name}</span>
                  {badge && (
                    <Badge tone={badge.tone} title={badge.title}>
                      {badge.text}
                    </Badge>
                  )}
                  <span style={{ marginLeft: 'auto', color: '#8898B0' }}>
                    {formatNumber(r.files)} file{r.files === 1 ? '' : 's'}
                    {isAvailable(r.lines) && ` · ${formatNumber(r.lines)} lines`}
                    {formatShare(r, totalFiles) && ` · ${formatShare(r, totalFiles)}`}
                  </span>
                </div>
                {isAvailable(r.percentage) && (
                  <div style={{ height: 4, borderRadius: 999, background: 'rgba(135, 155, 255, 0.1)', overflow: 'hidden' }}>
                    <div
                      style={{
                        width: `${Math.min(100, Math.max(0, r.percentage))}%`,
                        height: '100%',
                        background: getLanguageColor(r.name),
                        opacity: r.level === 'unsupported' || r.level === 'n/a' ? 0.45 : 0.9,
                      }}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <h4 style={sectionLabelStyle}>Not counted</h4>
      {!coverage ? (
        <div style={{ fontSize: 12, color: '#77839C' }}>Exclusion details were not reported for this analysis.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12, color: '#A7B4CC' }}>
          {isAvailable(coverage.discoveredFiles) && isAvailable(coverage.includedFiles) && (
            <div>
              Counted <strong style={{ color: '#EAF0FF' }}>{formatNumber(coverage.includedFiles)}</strong> of{' '}
              {formatNumber(coverage.discoveredFiles)} discovered files.
            </div>
          )}
          {excluded.length > 0 ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {excluded.map(([reason, n]) => (
                <Badge key={reason} tone="muted">
                  {humanizeKey(reason)}: {formatNumber(n)}
                </Badge>
              ))}
            </div>
          ) : (
            <div style={{ color: '#77839C' }}>No individual files were excluded.</div>
          )}
          {excludedDirs.length > 0 && (
            <details>
              <summary style={{ cursor: 'pointer', color: '#6898FF' }}>
                {excludedDirs.length} excluded director{excludedDirs.length === 1 ? 'y' : 'ies'}
              </summary>
              <ul style={{ margin: '6px 0 0', paddingLeft: 16, ...monoStyle, color: '#A7B4CC' }}>
                {excludedDirs.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            </details>
          )}
          {isAvailable(coverage.codeFiles) && isAvailable(coverage.analyzedCodeFiles) && (
            <div>
              Analyzed <strong style={{ color: '#EAF0FF' }}>{formatNumber(coverage.analyzedCodeFiles)}</strong> of{' '}
              {formatNumber(coverage.codeFiles)} code files; the rest are unsupported languages or were skipped.
            </div>
          )}
          {isAvailable(coverage.truncatedFiles) && coverage.truncatedFiles > 0 && (
            <div style={{ color: '#FFD166' }}>
              {formatNumber(coverage.truncatedFiles)} files were not analyzed because the file-count limit was reached.
            </div>
          )}
          {coverage.timedOut && <div style={{ color: '#FFD166' }}>The analysis hit its time limit before finishing.</div>}
          {parseCounts.length > 0 && (
            <div style={{ color: '#77839C', fontSize: 11 }}>
              Parse results: {parseCounts.map(([k, n]) => `${humanizeKey(k)} ${formatNumber(n)}`).join(' · ')}
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
