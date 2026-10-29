import { useMemo, useRef, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Bookmark, BookmarkCheck, CheckCircle2, Clock, ExternalLink, FileCode2, FilePlus2, FileText, Info, MessageSquareWarning, Search } from 'lucide-react';
import { codeViewLink, githubFileUrl } from '../../lib/codeLinks';
import Companion from './Companion';
import { askWithAI } from './askAI';
import { answerContributor, contributorSuggestions } from './companionAnswers';
import { filterOpportunities, type Certainty, type Opportunity, type OpportunityResult } from './opportunities';
import { plural, type RepoFacts } from './repoFacts';
import { usePathfinderStore, type ContributorTab } from './pathfinderStore';
import type { PathRepo } from './BeginnerPath';

const TABS: Array<{ id: ContributorTab; label: string }> = [{ id: 'overview', label: 'Overview' }, { id: 'files', label: 'Files' }, { id: 'how', label: 'How to Contribute' }];
const CERTAINTY: Record<Certainty, { label: string; title: string }> = {
  confirmed: { label: 'Confirmed finding', title: 'A finding the analyzer marks as confirmed (deterministic from the import graph).' },
  evidence: { label: 'Analysis evidence', title: 'Based on facts the analysis recorded (imports, files, test files).' },
  heuristic: { label: 'Heuristic · verify', title: 'Based on a threshold or naming pattern. Check it before you start.' },
};

interface Props { facts: RepoFacts; result: OpportunityResult; repo: PathRepo; onLearnFile: (path: string, line?: number) => void }

export default function ContributorPath({ facts, result, repo, onLearnFile }: Props) {
  const filters = usePathfinderStore((s) => s.filters);
  const saved = usePathfinderStore((s) => s.saved);
  const oppId = usePathfinderStore((s) => s.oppId);
  const chat = usePathfinderStore((s) => s.chats.contributor);
  const store = usePathfinderStore.getState;
  const all = result.list;
  const shown = useMemo(() => filterOpportunities(all, filters, saved), [all, filters, saved]);
  const selected = all.find((o) => o.id === oppId) ?? null;
  const types = [...new Set(all.map((o) => o.type))].sort();
  const areas = [...new Set(all.flatMap((o) => o.areas))].sort();
  const suggestions = useMemo(() => contributorSuggestions(selected), [selected]);
  const filtered = filters.type !== 'all' || filters.effort !== 'all' || filters.area !== 'all' || filters.savedOnly;

  const ask = async (q: { id?: string; text: string }) => {
    const before = chat;
    store().pushChat('contributor', { role: 'user', text: q.text });
    const main = selected?.files.find((f) => f.main && f.exists)?.path ?? null;
    const context = selected
      ? `Selected contribution opportunity: ${selected.title}. ${selected.summary}\nEvidence: ${selected.evidence.map((e) => e.text).join(' ')}\nFiles: ${selected.files.map((f) => `${f.path} (${f.role})`).join('; ')}\nSuggested steps: ${selected.steps.join(' ')}`
      : '';
    const answer = await askWithAI(repo._id, q.text, main, before, context, () => answerContributor(q.id ? { id: q.id } : { text: q.text }, facts, selected, all));
    store().pushChat('contributor', { role: 'companion', answer });
  };

  return (
    <div className="pf-contributor">
      <section className="pf-opps card" aria-label="Contribution opportunities">
        <div className="pf-row pf-between pf-wrap pf-opps-head">
          <div style={{ minWidth: 0 }}>
            <h2 className="pf-h2">Contribution Opportunities</h2>
            <p className="pf-muted pf-small">Ranked suggestions derived from the analysis of this repository. Effort levels are estimates.</p>
          </div>
          <div className="pf-filters" role="group" aria-label="Filter opportunities">
            <select className="pf-select" value={filters.type} onChange={(e) => store().setFilters({ type: e.target.value as never })} aria-label="Opportunity type">
              <option value="all">All types</option>
              {types.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <select className="pf-select" value={filters.effort} onChange={(e) => store().setFilters({ effort: e.target.value as never })} aria-label="Estimated effort">
              <option value="all">All efforts</option>
              <option value="Low">Low effort</option>
              <option value="Medium">Medium effort</option>
              <option value="High">High effort</option>
            </select>
            <select className="pf-select" value={filters.area} onChange={(e) => store().setFilters({ area: e.target.value })} aria-label="Repository area">
              <option value="all">All areas</option>
              {areas.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <button type="button" className="pf-btn pf-btn-sm" aria-pressed={filters.savedOnly} onClick={() => store().setFilters({ savedOnly: !filters.savedOnly })}>
              <Bookmark size={13} /> Saved ({[...saved].filter((id) => all.some((o) => o.id === id)).length})
            </button>
          </div>
        </div>

        {all.length === 0 ? (
          <div className="pf-empty-block">
            <Search size={22} color="#8B78FF" aria-hidden="true" />
            <p><strong>No evidence-based opportunities were found.</strong></p>
            <p className="pf-muted pf-small">The analysis found no architectural findings, test gaps, unresolved imports, documentation gaps or type-safety gaps it can point to. That does not mean there is nothing to improve, only that the analysis cannot show it.</p>
          </div>
        ) : shown.length === 0 ? (
          <div className="pf-empty-block">
            <Search size={22} color="#8B78FF" aria-hidden="true" />
            <p><strong>No opportunities match these filters.</strong></p>
            <button type="button" className="pf-btn pf-btn-sm" onClick={() => store().setFilters({ type: 'all', effort: 'all', area: 'all', savedOnly: false })}>Clear filters</button>
          </div>
        ) : (
          <ol className="pf-opp-list">
            {shown.map((o) => (
              <li key={o.id}>
                <button type="button" className={`pf-opp${o.id === oppId ? ' is-selected' : ''}`} onClick={() => store().selectOpp(o.id)} aria-pressed={o.id === oppId} aria-label={`${all.indexOf(o) + 1}. ${o.title}`}>
                  <span className="pf-opp-num" aria-hidden="true">{all.indexOf(o) + 1}</span>
                  <span className="pf-opp-body">
                    <span className="pf-opp-title">{o.title}{saved.has(o.id) && <BookmarkCheck size={13} className="pf-saved-mark" aria-label="Saved" />}</span>
                    <span className="pf-opp-sum">{o.summary}</span>
                    <span className="pf-chips">
                      {o.tags.map((t) => <span key={t} className="pf-tag">{t}</span>)}
                    </span>
                  </span>
                  <span className="pf-opp-side">
                    <span className="pf-chips is-end">
                      {o.goodFirst && <span className="pf-badge is-good"><CheckCircle2 size={11} aria-hidden="true" /> Good first issue</span>}
                      <span className={`pf-badge is-effort-${o.effort.toLowerCase()}`} title="Estimated effort">{o.effort} effort (est.)</span>
                    </span>
                    <span className={`pf-certainty is-${o.certainty}`} title={CERTAINTY[o.certainty].title}>{CERTAINTY[o.certainty].label}</span>
                    <span className="pf-opp-meta">
                      <span><FileText size={12} aria-hidden="true" /> {o.files.some((f) => f.exists) ? plural(o.files.filter((f) => f.exists).length, 'file') : plural(o.files.length, 'new file')}</span>
                      <span><MessageSquareWarning size={12} aria-hidden="true" /> {o.related.length ? plural(o.related.length, 'related finding') : 'No related findings'}</span>
                    </span>
                  </span>
                  <ArrowRight size={16} className="pf-opp-go" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ol>
        )}
        {filtered && shown.length > 0 && <p className="pf-muted pf-small">Showing {shown.length} of {plural(all.length, 'opportunity', 'opportunities')}.</p>}
        <details className="pf-limits">
          <summary><Info size={13} aria-hidden="true" /> What this list can and cannot show</summary>
          <ul>{result.limits.map((l, i) => <li key={i}>{l}</li>)}<li>Related issues on GitHub are not loaded; "related findings" are architectural findings of this analysis.</li></ul>
        </details>
      </section>

      <div className="pf-contrib-side">
        {selected ? <OpportunityPanel o={selected} facts={facts} repo={repo} onLearnFile={onLearnFile} /> : (
          <section className="pf-detail card pf-empty" aria-label="Selected opportunity"><p className="pf-muted">Select an opportunity to see what is involved and how to approach it.</p></section>
        )}
        <Companion
          compact
          title="Ask Astral AI"
          intro="Ask about this opportunity, the files or how to contribute."
          messages={chat}
          suggestions={suggestions}
          onAsk={ask}
          onOpenFile={onLearnFile}
          placeholder="Ask a question…"
        />
      </div>
    </div>
  );
}

function OpportunityPanel({ o, facts, repo, onLearnFile }: { o: Opportunity; facts: RepoFacts; repo: PathRepo; onLearnFile: (path: string, line?: number) => void }) {
  const tab = usePathfinderStore((s) => s.contributorTab);
  const saved = usePathfinderStore((s) => s.saved.has(o.id));
  const store = usePathfinderStore.getState;
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const main = o.files.find((f) => f.main && f.exists) ?? o.files.find((f) => f.exists);
  const mainNode = main ? facts.file(main.path) : undefined;
  const view = main ? codeViewLink(repo, main.path, main.line) : null;
  const gh = main ? githubFileUrl(repo, repo.commitSha, main.path, main.line) : null;

  const onTabKey = (e: KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const j = (i + d + TABS.length) % TABS.length;
    store().setContributorTab(TABS[j].id);
    tabRefs.current[j]?.focus();
  };

  return (
    <section className="pf-detail card pf-opp-panel" aria-label="Selected opportunity">
      <div className="pf-row pf-between">
        <h2 className="pf-h3" style={{ margin: 0 }}>Selected Opportunity</h2>
        <button type="button" className="pf-btn pf-btn-sm" aria-pressed={saved} onClick={() => store().toggleSaved(o.id)}>
          {saved ? <><BookmarkCheck size={13} /> Saved</> : <><Bookmark size={13} /> Save</>}
        </button>
      </div>
      <div className="pf-file-head">
        <FileCode2 size={24} className="pf-file-icon" aria-hidden="true" />
        <div style={{ minWidth: 0 }}>
          <h3 className="pf-file-name">{o.title}</h3>
          <div className="pf-chips">
            {o.goodFirst && <span className="pf-badge is-good"><CheckCircle2 size={11} aria-hidden="true" /> Good first issue</span>}
            <span className={`pf-certainty is-${o.certainty}`} title={CERTAINTY[o.certainty].title}>{CERTAINTY[o.certainty].label}</span>
          </div>
        </div>
      </div>
      <div className="pf-stats">
        <div><Clock size={16} aria-hidden="true" /><span><strong>{o.effort} effort</strong><span className="pf-muted pf-small">estimate</span></span></div>
        <div><FileText size={16} aria-hidden="true" /><span><strong>{plural(o.files.filter((f) => f.exists).length, 'file')}</strong><span className="pf-muted pf-small">{o.files.some((f) => !f.exists) ? '+ suggested new' : 'involved'}</span></span></div>
        <div><AlertTriangle size={16} aria-hidden="true" /><span><strong>{plural(o.related.length, 'finding')}</strong><span className="pf-muted pf-small">related</span></span></div>
      </div>

      <div className="pf-tabs" role="tablist" aria-label="Opportunity details">
        {TABS.map((t, i) => (
          <button
            key={t.id} type="button" role="tab" id={`pf-otab-${t.id}`} aria-controls="pf-otabpanel" aria-selected={tab === t.id} tabIndex={tab === t.id ? 0 : -1}
            ref={(el) => { tabRefs.current[i] = el; }} className={`pf-tab${tab === t.id ? ' is-active' : ''}`}
            onClick={() => store().setContributorTab(t.id)} onKeyDown={(e) => onTabKey(e, i)}
          >{t.label}</button>
        ))}
      </div>

      <div className="pf-tabpanel" id="pf-otabpanel" role="tabpanel" aria-labelledby={`pf-otab-${tab}`}>
        {tab === 'overview' && (
          <>
            <h4 className="pf-h4">What needs improvement?</h4>
            <p className="pf-p">{o.summary}</p>
            <h4 className="pf-h4">Why it matters</h4>
            <ul className="pf-list">{o.why.map((w, i) => <li key={i}>{w}</li>)}</ul>
            <h4 className="pf-h4">Why it could be a good contribution</h4>
            <ul className="pf-list is-check">{o.whyGood.map((w, i) => <li key={i}>{w}</li>)}</ul>
            <h4 className="pf-h4">Evidence from the repository</h4>
            <ul className="pf-evidence-list">
              {o.evidence.map((e, i) => (
                <li key={i}>
                  <span className={`pf-certainty is-${e.certainty}`}>{CERTAINTY[e.certainty].label}</span>
                  <span>{e.text}{e.path && <> <button type="button" className="pf-linkbtn" onClick={() => onLearnFile(e.path!, e.line)}>{facts.name(e.path)}{e.line ? `:${e.line}` : ''}</button></>}</span>
                </li>
              ))}
            </ul>
            {o.related.length > 0 && (
              <>
                <h4 className="pf-h4">Related architectural findings</h4>
                <ul className="pf-list">{o.related.map((r, i) => <li key={i}><strong>{r.rule}</strong> ({r.severity}{r.confidence ? `, ${r.confidence}` : ''}): {r.description}</li>)}</ul>
              </>
            )}
          </>
        )}

        {tab === 'files' && (
          <ul className="pf-files">
            {o.files.map((f) => {
              const link = f.exists ? codeViewLink(repo, f.path, f.line) : null;
              const gl = f.exists ? githubFileUrl(repo, repo.commitSha, f.path, f.line) : null;
              return (
                <li key={f.path} className={f.exists ? undefined : 'is-new'}>
                  {f.exists ? <FileText size={15} aria-hidden="true" /> : <FilePlus2 size={15} aria-hidden="true" />}
                  <div className="pf-files-text">
                    <span className="pf-files-path" title={f.path}>{f.path}{f.main && <span className="pf-chip is-small">Main file</span>}{!f.exists && <span className="pf-chip is-small is-warn">Suggested · not created</span>}</span>
                    <span className="pf-muted pf-small">{f.role}</span>
                    {f.exists && (
                      <span className="pf-files-actions">
                        <button type="button" className="pf-linkbtn" onClick={() => onLearnFile(f.path, f.line)}>Preview &amp; explain</button>
                        {link && <Link className="pf-linkbtn" to={link.to}>{link.label}</Link>}
                        {gl && <a className="pf-linkbtn" href={gl} target="_blank" rel="noreferrer noopener">GitHub <ExternalLink size={11} /></a>}
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {tab === 'how' && (
          <>
            <p className="pf-evidence">Suggested approach, written from the evidence above. It is guidance, not a verified plan: check each step against the code.</p>
            <h4 className="pf-h4">Steps</h4>
            <ol className="pf-list is-numbered">{o.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
            {mainNode && mainNode.functions.length > 0 && (
              <>
                <h4 className="pf-h4">Functions and components to inspect in {mainNode.name}</h4>
                <div className="pf-chips">
                  {mainNode.functions.filter((fn) => fn.kind !== 'method').slice(0, 12).map((fn) => (
                    <button key={`${fn.name}:${fn.line}`} type="button" className="pf-link-chip" onClick={() => onLearnFile(mainNode.path, fn.line)}>{fn.name} · L{fn.line}</button>
                  ))}
                </div>
              </>
            )}
            <h4 className="pf-h4">Testing</h4>
            <ul className="pf-list">{o.tests.map((t, i) => <li key={i}>{t}</li>)}</ul>
          </>
        )}
      </div>

      {main && (
        <footer className="pf-detail-foot">
          {view && <Link className="pf-btn pf-btn-primary" to={view.to}>{view.label} <ArrowRight size={15} /></Link>}
          {gh ? <a className="pf-btn" href={gh} target="_blank" rel="noreferrer noopener">View on GitHub <ExternalLink size={13} /></a>
            : <span className="pf-muted pf-small">{repo.source === 'zip' ? 'ZIP uploads have no GitHub page.' : 'No GitHub link: the analysed commit is unknown.'}</span>}
        </footer>
      )}
    </section>
  );
}
