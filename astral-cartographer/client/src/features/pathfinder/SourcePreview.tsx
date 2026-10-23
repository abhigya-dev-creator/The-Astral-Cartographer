import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import CodeViewer from '../../components/CodeViewer';
import { fetchFileSource, type FetchSourceResult } from '../../lib/fetchFileSource';

interface Props {
  repo: { owner: string; name: string; source?: 'github' | 'zip' };
  commitSha: string;
  path: string;
  target: { line: number; nonce: number } | null;
}

/** The file's real source at the analysed commit (from GitHub), with syntax colours where supported. */
export default function SourcePreview({ repo, commitSha, path, target }: Props) {
  const [state, setState] = useState<{ path: string; result: FetchSourceResult | null }>({ path, result: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    setState({ path, result: null });
    fetchFileSource(repo, path, commitSha, { signal: ctrl.signal }).then((result) => {
      if (!ctrl.signal.aborted) setState({ path, result });
    });
    return () => ctrl.abort();
  }, [repo.owner, repo.name, repo.source, commitSha, path, attempt]);

  const r = state.path === path ? state.result : null;
  if (!r) return <p className="pf-muted pf-row" role="status"><RefreshCw size={14} className="spin" /> Loading the source from GitHub…</p>;
  if (!r.ok) {
    return (
      <div className="pf-note" role="note">
        <p>{r.message}</p>
        {(r.code === 'timeout' || r.code === 'network' || r.code === 'rate-limited') && (
          <button type="button" className="pf-btn pf-btn-sm" onClick={() => setAttempt((n) => n + 1)}><RefreshCw size={13} /> Try again</button>
        )}
      </div>
    );
  }
  return (
    <div className="pf-code">
      <CodeViewer code={r.text} path={path} target={target} label={`Source of ${path} at commit ${commitSha.slice(0, 7)}`} />
    </div>
  );
}
