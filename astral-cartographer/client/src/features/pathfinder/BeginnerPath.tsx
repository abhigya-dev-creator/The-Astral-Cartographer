import { useMemo, useRef, useState, useEffect, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, CheckCircle2, Circle, CircleDot, ExternalLink, FileText, GitFork, Package, RotateCcw, Layers, Compass } from 'lucide-react';
import { codeViewLink, githubFileUrl, type CodeLinkRepo } from '../../lib/codeLinks';
import Companion from './Companion';
import { askWithAI } from './askAI';
import SourcePreview from './SourcePreview';
import { answerBeginner, beginnerSuggestions, explainFile } from './companionAnswers';
import { nextStepReason, type LearningStep } from './learningPath';
import { languageOfFile, plural, type RepoFacts } from './repoFacts';
import { usePathfinderStore, type BeginnerTab } from './pathfinderStore';
import { BeginnerRoadmap } from './BeginnerRoadmap';
import { FileExplanationCard } from './FileExplanationCard';
import { api, type DynamicRoadmapResult, type FileExplanation } from '../../lib/api';

export interface PathRepo extends CodeLinkRepo { commitSha: string }

type Status = 'Completed' | 'In Progress' | 'Not Started';

const TABS: Array<{ id: BeginnerTab; label: string }> = [
  { id: 'overview', label: 'Overview' }, { id: 'connections', label: 'Connections' }, { id: 'code', label: 'Code Preview' }, { id: 'next', label: 'Next Step' },
];

export function useStepStatus(): (path: string) => Status {
  const completed = usePathfinderStore((s) => s.completed);
  const current = usePathfinderStore((s) => s.current);
  return (path) => (completed.has(path) ? 'Completed' : current === path ? 'In Progress' : 'Not Started');
}

function StatusBadge({ status }: { status: Status }) {
  const Icon = status === 'Completed' ? CheckCircle2 : status === 'In Progress' ? CircleDot : Circle;
  return <span className={`pf-status is-${status.replace(' ', '-').toLowerCase()}`}><Icon size={12} aria-hidden="true" /> {status}</span>;
}

/** Learning progress: completed steps of the current queue (progress on files no longer in the queue is not counted). */
export function ProgressPanel({ steps }: { steps: LearningStep[] }) {
  const completed = usePathfinderStore((s) => s.completed);
  const current = usePathfinderStore((s) => s.current);
  const sync = usePathfinderStore((s) => s.sync);
  const syncMessage = usePathfinderStore((s) => s.syncMessage);
  const done = steps.filter((s) => completed.has(s.path)).length;
  const pct = steps.length ? Math.round((done / steps.length) * 100) : 0;
  const idx = steps.findIndex((s) => s.path === current);
  return (
    <section className="pf-progress card" aria-label="Learning progress">
      <div className="pf-row pf-between">
        <h2 className="pf-h3">Learning Progress</h2>
        <strong className="pf-progress-pct">{pct}%</strong>
      </div>
      <div className="pf-bar" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={done} aria-label={`${done} of ${steps.length} steps completed`}>
        <span style={{ width: `${pct}%` }} />
      </div>
      <p className="pf-small pf-muted">
        {done} / {plural(steps.length, 'step')} completed{idx >= 0 ? ` · on step ${idx + 1}: ${steps[idx].path.slice(steps[idx].path.lastIndexOf('/') + 1)}` : ''}
      </p>
      <p className={`pf-small pf-sync${sync === 'error' || sync === 'local' ? ' is-warn' : ''}`} role={sync === 'error' ? 'alert' : undefined}>
        {sync === 'saving' ? 'Saving…' : sync === 'loading' ? 'Loading saved progress…' : sync === 'saved' ? 'Progress is saved to your account.' : syncMessage ?? ''}
      </p>
    </section>
  );
}

interface Props { facts: RepoFacts; steps: LearningStep[]; repo: PathRepo; onExploreContributing: () => void }

export default function BeginnerPath({ facts, steps, repo, onExploreContributing }: Props) {
  const path = usePathfinderStore((s) => s.beginnerPath);
  const chat = usePathfinderStore((s) => s.chats.beginner);
  const completed = usePathfinderStore((s) => s.completed);
  const store = usePathfinderStore.getState;
  const status = useStepStatus();
  const idx = steps.findIndex((s) => s.path === path);
  const step = idx >= 0 ? steps[idx] : null;
  const suggestions = useMemo(() => beginnerSuggestions(step, path), [step, path]);

  // Dynamic learning state
  const [roadmap, setRoadmap] = useState<DynamicRoadmapResult | null>(null);
  const [, setRoadmapLoading] = useState(false);
  const [explanation, setExplanation] = useState<FileExplanation | null>(null);
  const [explanationLoading, setExplanationLoading] = useState(false);
  const [sourceType, setSourceType] = useState<string | undefined>(undefined);
  const [useDynamicView, setUseDynamicView] = useState(true);

  // Fetch dynamic roadmap for repository
  useEffect(() => {
    if (!repo._id || repo._id === 'sample') return;
    let active = true;
    setRoadmapLoading(true);
    api.getLearningRoadmap(repo._id)
      .then((res) => {
        if (active && res?.success && res?.roadmap) {
          setRoadmap(res.roadmap);
          const firstFile = res.roadmap.stages.find((st) => st.files.length > 0)?.files[0];
          if (firstFile && !usePathfinderStore.getState().beginnerPath) {
            store().openFile(firstFile.path);
          }
        }
      })
      .catch((err) => {
        console.warn('Dynamic learning roadmap unavailable, falling back:', err);
      })
      .finally(() => {
        if (active) setRoadmapLoading(false);
      });
    return () => { active = false; };
  }, [repo._id]);

  // Fetch file explanation when active path changes
  useEffect(() => {
    if (!repo._id || !path || repo._id === 'sample') {
      setExplanation(null);
      return;
    }
    let active = true;
    setExplanationLoading(true);
    api.getFileExplanation(repo._id, path)
      .then((res) => {
        if (active && res?.success && res?.explanation) {
          setExplanation(res.explanation);
          setSourceType(res.source);
        }
      })
      .catch((err) => {
        console.warn('File explanation unavailable:', err);
        if (active) setExplanation(null);
      })
      .finally(() => {
        if (active) setExplanationLoading(false);
      });
    return () => { active = false; };
  }, [repo._id, path]);

  const handleRefreshAi = async () => {
    if (!repo._id || !path) return;
    setExplanationLoading(true);
    try {
      const res = await api.getFileExplanation(repo._id, path, true);
      if (res?.success && res?.explanation) {
        setExplanation(res.explanation);
        setSourceType(res.source);
      }
    } catch (err) {
      console.error('Failed to enrich file explanation with AI:', err);
    } finally {
      setExplanationLoading(false);
    }
  };

  const ask = async (q: { id?: string; text: string }) => {
    const before = chat;
    store().pushChat('beginner', { role: 'user', text: q.text });
    const context = step
      ? `Learning step "${step.roleLabel}": ${step.summary} ${step.what.join(' ')}`
      : explanation
      ? `File: ${explanation.filePath}. Purpose: ${explanation.overview.purpose}. Role: ${explanation.architecturalRole.layer}`
      : '';
    const answer = await askWithAI(repo._id, q.text, path, before, context, () => answerBeginner(q.id ? { id: q.id } : { text: q.text }, facts, path, steps));
    store().pushChat('beginner', { role: 'companion', answer });
  };

  return (
    <div className="pf-beginner">
      {/* Left panel: Roadmap / Queue */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {roadmap && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '0 4px' }}>
            <button
              type="button"
              className="pf-linkbtn pf-small"
              onClick={() => setUseDynamicView((v) => !v)}
              style={{ fontSize: 11, color: '#38BDF8' }}
            >
              {useDynamicView ? 'Switch to Classic Queue' : 'Switch to Dynamic Roadmap'}
            </button>
          </div>
        )}

        {useDynamicView && roadmap ? (
          <BeginnerRoadmap
            roadmap={roadmap}
            selectedFilePath={path}
            completedFiles={completed}
            onSelectFile={(p) => store().openFile(p)}
            repoId={repo._id}
          />
        ) : (
          <section className="pf-queue card" aria-label="Learning queue">
            <h2 className="pf-h2">Learning Queue <span className="pf-muted pf-h2-sub">({plural(steps.length, 'step')})</span></h2>
            {steps.length === 0
              ? <p className="pf-muted pf-small">The analysis did not find enough structure to build a learning path for this repository. Use the search to open any file.</p>
              : (
                <ol className="pf-steps">
                  {steps.map((s, i) => {
                    const st = status(s.path);
                    return (
                      <li key={s.path} className={`pf-step${s.path === path ? ' is-selected' : ''} is-${st.replace(' ', '-').toLowerCase()}`}>
                        <span className="pf-step-num" aria-hidden="true">{i + 1}</span>
                        <button type="button" className="pf-step-card" onClick={() => store().openFile(s.path)} aria-current={s.path === path ? 'step' : undefined} aria-label={`Step ${i + 1}: ${s.path}, ${st}`}>
                          <FileText size={16} className="pf-step-icon" aria-hidden="true" />
                          <span className="pf-step-text">
                            <span className="pf-step-name">{facts.name(s.path)}</span>
                            <span className="pf-step-path">{s.path}</span>
                            <span className="pf-step-sum">{s.summary}</span>
                            <StatusBadge status={st} />
                          </span>
                          <ArrowRight size={15} className="pf-step-go" aria-hidden="true" />
                        </button>
                      </li>
                    );
                  })}
                </ol>
              )}
          </section>
        )}
      </div>

      {/* Center panel: 7-Section Explanation Card or Step Details */}
      {path ? (
        useDynamicView && explanation ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: '#77839C' }}>
                Structured Architectural Analysis
              </span>
              <button
                type="button"
                className="pf-linkbtn pf-small"
                onClick={() => setUseDynamicView(false)}
                style={{ fontSize: 11 }}
              >
                Show Classic Step View
              </button>
            </div>
            <FileExplanationCard
              explanation={explanation}
              repoId={repo._id}
              sourceType={sourceType}
              isLoading={explanationLoading}
              onRefreshAi={handleRefreshAi}
              onNavigateToFile={(p, line) => store().openFile(p, line ? { line, tab: 'code' } : undefined)}
            />
          </div>
        ) : (
          <StepPanel facts={facts} steps={steps} path={path} step={step} index={idx} repo={repo} status={status(path)} onExploreContributing={onExploreContributing} />
        )
      ) : (
        <section className="pf-detail card pf-empty"><p className="pf-muted">Choose a step from the learning queue or roadmap to begin.</p></section>
      )}

      {/* Right panel: Companion chatbot */}
      <Companion
        title="AI Coding Companion"
        intro="Ask about this file, the codebase or how parts connect."
        messages={chat}
        suggestions={suggestions}
        onAsk={ask}
        onOpenFile={(p, line) => store().openFile(p, line ? { line, tab: 'code' } : undefined)}
        placeholder="Ask anything about this codebase…"
      />
    </div>
  );
}

function StepPanel({ facts, steps, path, step, index, repo, status, onExploreContributing }: {
  facts: RepoFacts; steps: LearningStep[]; path: string; step: LearningStep | null; index: number; repo: PathRepo; status: Status; onExploreContributing: () => void;
}) {
  const tab = usePathfinderStore((s) => s.beginnerTab);
  const codeLine = usePathfinderStore((s) => s.codeLine);
  const store = usePathfinderStore.getState;
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const f = facts.file(path);
  const prev = index > 0 ? steps[index - 1] : null;
  const next = index >= 0 && index < steps.length - 1 ? steps[index + 1] : null;
  const firstOpen = steps.find((s) => !usePathfinderStore.getState().completed.has(s.path)) ?? steps[0];
  const view = codeViewLink(repo, path);
  const gh = githubFileUrl(repo, repo.commitSha, path);

  if (!f) return <section className="pf-detail card pf-empty"><p className="pf-muted">{path} is not part of this analysis.</p></section>;

  const onTabKey = (e: KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const j = (i + d + TABS.length) % TABS.length;
    store().setBeginnerTab(TABS[j].id);
    tabRefs.current[j]?.focus();
  };

  const imports = facts.imports(path);
  const importedBy = facts.importedBy(path);
  const related = [...imports, ...importedBy.filter((l) => !imports.some((x) => x.path === l.path))].slice(0, 3);
  const explain = step ? null : explainFile(facts, path, null);

  return (
    <section className="pf-detail card" aria-label={`Details of ${path}`}>
      <div className="pf-row pf-between pf-wrap">
        <span className="pf-muted pf-small">{step ? `Step ${index + 1} of ${steps.length}` : 'Outside the learning path'}</span>
        {step ? <StatusBadge status={status} /> : <span className="pf-status">Exploring</span>}
      </div>
      <div className="pf-file-head">
        <FileText size={26} className="pf-file-icon" aria-hidden="true" />
        <div style={{ minWidth: 0 }}>
          <h2 className="pf-file-name">{f.name}</h2>
          <p className="pf-file-path" title={path}>{path}</p>
        </div>
      </div>
      <div className="pf-chips">
        {step && <span className="pf-chip">{step.roleLabel}</span>}
        <span className="pf-chip">{languageOfFile(f)}</span>
        <span className="pf-chip">{plural(f.lines, 'line')}</span>
        {step && <span className={`pf-chip${step.importance === 'High' ? ' is-strong' : ''}`}>{step.importance} importance</span>}
        {facts.model.cycleOf.has(path) && <span className="pf-chip is-warn">In a circular dependency</span>}
      </div>

      <div className="pf-tabs" role="tablist" aria-label="Step details">
        {TABS.map((t, i) => (
          <button
            key={t.id} type="button" role="tab" id={`pf-tab-${t.id}`} aria-controls="pf-tabpanel" aria-selected={tab === t.id} tabIndex={tab === t.id ? 0 : -1}
            ref={(el) => { tabRefs.current[i] = el; }} className={`pf-tab${tab === t.id ? ' is-active' : ''}`}
            onClick={() => store().setBeginnerTab(t.id)} onKeyDown={(e) => onTabKey(e, i)}
          >{t.label}</button>
        ))}
      </div>

      <div className="pf-tabpanel" id="pf-tabpanel" role="tabpanel" aria-labelledby={`pf-tab-${tab}`}>
        {tab === 'overview' && (
          <>
            {step ? (
              <>
                <h3 className="pf-h3">What does this file do?</h3>
                {step.what.map((p, i) => <p key={i} className="pf-p">{p}</p>)}
                <h3 className="pf-h3">Why is this important?</h3>
                <ul className="pf-list">{step.why.map((w, i) => <li key={i}>{w}</li>)}</ul>
                <h3 className="pf-h3">Key things to look for</h3>
                <ul className="pf-list">{step.lookFor.map((w, i) => <li key={i}>{w}</li>)}</ul>
                <p className="pf-evidence">Chosen because: {step.evidence.join(' · ')}. Explanations come from the analysis (names, imports and declarations), not from reading the code.</p>
              </>
            ) : (
              <>
                <h3 className="pf-h3">What the analysis knows about this file</h3>
                {explain!.paragraphs.map((p, i) => <p key={i} className="pf-p">{p}</p>)}
                <ul className="pf-list">{explain!.bullets?.map((b, i) => <li key={i}>{b}</li>)}</ul>
                <p className="pf-evidence">This file is not part of the learning path. {firstOpen ? <button type="button" className="pf-linkbtn" onClick={() => store().openFile(firstOpen.path)}>Return to the path</button> : null}</p>
              </>
            )}
            {related.length > 0 && (
              <>
                <h3 className="pf-h3">Related files</h3>
                <div className="pf-related">
                  {related.map((l) => (
                    <button key={l.path} type="button" className="pf-related-card" onClick={() => store().openFile(l.path)} title={l.path}>
                      <FileText size={15} aria-hidden="true" />
                      <span><strong>{facts.name(l.path)}</strong><span className="pf-muted pf-small">{imports.some((x) => x.path === l.path) ? `Imported here (line ${l.line})` : `Imports this file (line ${l.line})`}</span></span>
                      <ArrowRight size={14} aria-hidden="true" />
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {tab === 'connections' && <Connections facts={facts} path={path} steps={steps} />}

        {tab === 'code' && (
          repo.source === 'github'
            ? <SourcePreview repo={repo} commitSha={repo.commitSha} path={path} target={codeLine} />
            : <p className="pf-note">Code preview is not available for ZIP uploads: there is no GitHub address to load the file from.</p>
        )}

        {tab === 'next' && (
          <div>
            {step && next ? (
              <>
                <h3 className="pf-h3">Up next: {facts.name(next.path)}</h3>
                <p className="pf-p">{nextStepReason(facts, step, next)}</p>
                <p className="pf-p pf-muted">{next.summary}</p>
                <h3 className="pf-h3">Before you move on, make sure you can answer</h3>
                <ul className="pf-list">{step.lookFor.map((w, i) => <li key={i}>{w}</li>)}</ul>
                <button type="button" className="pf-btn pf-btn-primary" onClick={() => { store().setComplete(path, true); store().openFile(next.path); }}>
                  <CheckCircle2 size={15} /> Mark complete and continue
                </button>
              </>
            ) : step ? (
              <>
                <h3 className="pf-h3">This is the last step</h3>
                <p className="pf-p">You have reached the end of the learning path. When you feel ready, the Contributor Path lists concrete, evidence-based places to contribute.</p>
                <div className="pf-row pf-wrap">
                  {status !== 'Completed' && <button type="button" className="pf-btn" onClick={() => store().setComplete(path, true)}><CheckCircle2 size={15} /> Mark complete</button>}
                  <button type="button" className="pf-btn pf-btn-primary" onClick={onExploreContributing}><GitFork size={15} /> Explore the Contributor Path</button>
                </div>
              </>
            ) : (
              <>
                <h3 className="pf-h3">Back to the learning path</h3>
                <p className="pf-p">{firstOpen ? `The next unfinished step is ${facts.name(firstOpen.path)}.` : 'The learning path is empty for this repository.'}</p>
                {firstOpen && <button type="button" className="pf-btn pf-btn-primary" onClick={() => store().openFile(firstOpen.path)}>Go to {facts.name(firstOpen.path)} <ArrowRight size={15} /></button>}
              </>
            )}
          </div>
        )}
      </div>

      <footer className="pf-detail-foot">
        <button type="button" className="pf-btn" disabled={!prev} onClick={() => prev && store().openFile(prev.path)}><ArrowLeft size={15} /> Previous file</button>
        {step && (
          <button type="button" className="pf-btn" onClick={() => store().setComplete(path, status !== 'Completed')} aria-pressed={status === 'Completed'}>
            {status === 'Completed' ? <><RotateCcw size={14} /> Mark not complete</> : <><CheckCircle2 size={15} /> Mark complete</>}
          </button>
        )}
        <Link className="pf-btn" to={view.to}>{view.label} <ArrowRight size={15} /></Link>
        {gh && <a className="pf-btn" href={gh} target="_blank" rel="noreferrer noopener">GitHub <ExternalLink size={13} /></a>}
        <button type="button" className="pf-btn pf-btn-primary" disabled={!next} onClick={() => next && store().openFile(next.path)}>Next step <ArrowRight size={15} /></button>
      </footer>
    </section>
  );
}

function Connections({ facts, path, steps }: { facts: RepoFacts; path: string; steps: LearningStep[] }) {
  const store = usePathfinderStore.getState;
  const imports = facts.imports(path);
  const importedBy = facts.importedBy(path);
  const pkgs = facts.packages(path);
  const unresolved = (facts.model.outgoing.get(path) ?? []).filter((e) => e.status === 'unresolved');
  const stepNo = (p: string) => { const i = steps.findIndex((s) => s.path === p); return i >= 0 ? `step ${i + 1}` : null; };
  const List = ({ items, empty, verb }: { items: typeof imports; empty: string; verb: string }) => (
    items.length === 0 ? <p className="pf-muted pf-small">{empty}</p> : (
      <ul className="pf-conn-list">
        {items.map((l) => (
          <li key={l.path}>
            <button type="button" className="pf-conn" onClick={() => store().openFile(l.path)} title={`Open ${l.path}`}>
              <span className="pf-conn-name">{facts.name(l.path)}{facts.isTest(l.path) && <span className="pf-chip is-small">test</span>}{stepNo(l.path) && <span className="pf-chip is-small">{stepNo(l.path)}</span>}</span>
              <span className="pf-conn-path">{l.path}</span>
            </button>
            <button type="button" className="pf-linkbtn pf-small" onClick={() => store().openFile(verb === 'imports' ? path : l.path, { line: l.line, tab: 'code' })} title={verb === 'imports' ? `Show line ${l.line} of ${facts.name(path)}` : `Show line ${l.line} of ${facts.name(l.path)}`}>line {l.line}</button>
          </li>
        ))}
      </ul>
    )
  );
  return (
    <div>
      <p className="pf-evidence">Relationships come from the import analysis: only imports the analyzer resolved to repository files are listed.</p>
      <h3 className="pf-h3">Imports ({imports.length})</h3>
      <List items={imports} empty="This file imports no other repository files." verb="imports" />
      <h3 className="pf-h3">Imported by ({importedBy.length})</h3>
      <List items={importedBy} empty="No analysed file imports this file." verb="importedBy" />
      {pkgs.length > 0 && (
        <>
          <h3 className="pf-h3">External packages ({pkgs.length})</h3>
          <div className="pf-chips">{pkgs.map((p) => <span key={p} className="pf-chip"><Package size={11} aria-hidden="true" /> {p}</span>)}</div>
        </>
      )}
      {unresolved.length > 0 && <p className="pf-note">{plural(unresolved.length, 'import')} could not be resolved ({[...new Set(unresolved.map((e) => e.reason))].join(', ')}), so {unresolved.length === 1 ? 'it is' : 'they are'} not shown as connections.</p>}
    </div>
  );
}
