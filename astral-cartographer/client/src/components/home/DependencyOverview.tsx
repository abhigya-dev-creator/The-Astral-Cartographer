import { Network } from 'lucide-react';
import { AnalysisSummary, IDependencyMetrics } from '../../lib/api';
import { DEFAULT_NA_REASON, definitionFor, formatNumber, isAvailable } from '../../lib/analysisFormat';
import { EmptyState, InfoTip, Panel, PartialBadge, sectionLabelStyle } from './ui';

type MetricKey = keyof IDependencyMetrics;

const PACKAGE_ROWS: Array<{ key: MetricKey; label: string }> = [
  { key: 'externalPackages', label: 'External packages' },
  { key: 'builtInModules', label: 'Built-in modules' },
];

const GRAPH_ROWS: Array<{ key: MetricKey; label: string; warnIfPositive?: boolean }> = [
  { key: 'localDependencies', label: 'Local dependencies (unique target files)' },
  { key: 'dependencyLinks', label: 'Dependency graph links (edges)' },
  { key: 'unresolvedLocalImports', label: 'Unresolved local imports', warnIfPositive: true },
  { key: 'rawImportStatements', label: 'Raw import statements' },
];

const SECONDARY_ROWS: Array<{ key: MetricKey; label: string }> = [
  { key: 'assetImports', label: 'Asset imports' },
  { key: 'unresolvedAliasImports', label: 'Unresolved alias imports' },
  { key: 'dynamicNonLiteralImports', label: 'Dynamic non-literal imports' },
  { key: 'typeOnlyEdges', label: 'Type-only edges' },
  { key: 'urlImports', label: 'URL imports' },
  { key: 'aliasResolvedImports', label: 'Alias-resolved imports' },
];

function StatRow({ label, value, tip, warn }: { label: string; value: number | undefined; tip?: string; warn?: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 12,
        padding: '7px 0',
        borderBottom: '1px solid rgba(135, 155, 255, 0.08)',
        fontSize: 12,
      }}
    >
      <span style={{ color: '#A7B4CC', display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
        {label} <InfoTip text={tip} />
      </span>
      <span style={{ fontWeight: 600, color: !isAvailable(value) ? '#8898B0' : warn && value > 0 ? '#FF949C' : '#EAF0FF' }}>
        {isAvailable(value) ? formatNumber(value) : 'N/A'}
      </span>
    </div>
  );
}

export default function DependencyOverview({ analysis }: { analysis: AnalysisSummary }) {
  const m = analysis.metrics;
  const dm = m.dependencyMetrics;
  const status = m.supportStatus?.dependenciesStatus;
  const secondary = dm ? SECONDARY_ROWS.filter((r) => isAvailable(dm[r.key])) : [];

  return (
    <Panel title="Dependency Overview" action={status === 'partial' ? <PartialBadge support={m.supportStatus} /> : undefined}>
      {!dm ? (
        <EmptyState icon={<Network size={26} color="#FFAD66" />} title="Dependency metrics: N/A">
          {m.supportStatus?.reason || DEFAULT_NA_REASON}
        </EmptyState>
      ) : (
        <>
          <h4 style={sectionLabelStyle}>Packages &amp; modules</h4>
          <div style={{ marginBottom: 18 }}>
            {PACKAGE_ROWS.map((r) => (
              <StatRow key={r.key} label={r.label} value={dm[r.key]} tip={definitionFor(m, r.key)} />
            ))}
          </div>

          <h4 style={sectionLabelStyle}>Internal dependency graph</h4>
          <div>
            {GRAPH_ROWS.map((r) => (
              <StatRow key={r.key} label={r.label} value={dm[r.key]} tip={definitionFor(m, r.key)} warn={r.warnIfPositive} />
            ))}
          </div>

          {secondary.length > 0 && (
            <details style={{ marginTop: 14 }}>
              <summary style={{ cursor: 'pointer', fontSize: 12, color: '#6898FF' }}>More import detail</summary>
              <div style={{ marginTop: 6 }}>
                {secondary.map((r) => (
                  <StatRow key={r.key} label={r.label} value={dm[r.key]} tip={definitionFor(m, r.key)} />
                ))}
              </div>
            </details>
          )}
        </>
      )}
    </Panel>
  );
}
