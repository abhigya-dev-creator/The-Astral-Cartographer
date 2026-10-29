import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { ChevronLeft, FolderTree, AlertCircle, RefreshCw } from 'lucide-react';
import '../features/explorer/explorer.css';
import { useRepositoryStore } from '../context/repositoryStore';
import { api, type RepositorySummary, type IArchitecturalIssue, type CodeIssue } from '../lib/api';
import { fetchAtlas } from '../features/atlas/atlasApi';
import { parseAtlasData, type AtlasData, type FileNode } from '../features/atlas/model';
import { fetchFileSource } from '../lib/fetchFileSource';
import { FileTreePanel } from '../features/explorer/FileTreePanel';
import { SourceViewerPanel } from '../features/explorer/SourceViewerPanel';
import { ContextPanel } from '../features/explorer/ContextPanel';
import { TopSearchBar } from '../features/explorer/TopSearchBar';
import { RepoSelectorDropdown } from '../features/explorer/RepoSelectorDropdown';
import { getAncestorPaths } from '../features/explorer/explorerTreeUtils';
import type {
  ExplorerFileItem,
  ExplorerTab,
  ExplorerDependency,
  ExplorerDependent,
} from '../features/explorer/explorerTypes';

export default function CodeExplorer() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const { repositories, selectedRepo, setRepositories, setSelectedRepo } = useRepositoryStore();

  const [isLoadingRepos, setIsLoadingRepos] = useState(repositories.length === 0);
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);

  // Core Explorer Data
  const [fileMap, setFileMap] = useState<Map<string, ExplorerFileItem>>(new Map());
  const [filesList, setFilesList] = useState<ExplorerFileItem[]>([]);
  const [openTabs, setOpenTabs] = useState<ExplorerTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  // Expanded folders in Tree
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['']));

  // Source code state for active tab
  const [sourceCode, setSourceCode] = useState<string | null>(null);
  const [isLoadingSource, setIsLoadingSource] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);

  // Code inspection issues & problems drawer state
  const [fileIssues, setFileIssues] = useState<CodeIssue[]>([]);
  const [isLoadingInspection, setIsLoadingInspection] = useState(false);
  const [isAiInspecting, setIsAiInspecting] = useState(false);
  const [isProblemsOpen, setIsProblemsOpen] = useState(false);

  // Target line scrolling
  const [targetLine, setTargetLine] = useState<number | null>(null);
  const [targetNonce, setTargetNonce] = useState(0);

  // Fullscreen toggle
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Determine current active repository
  const repoParam = searchParams.get('repo');
  const pathParam = searchParams.get('path') || searchParams.get('file');
  const lineParam = searchParams.get('line');

  // Load repositories on mount if empty
  useEffect(() => {
    if (repositories.length > 0) return;
    let cancelled = false;

    api
      .getRepositories()
      .then((repos) => {
        if (cancelled) return;
        setRepositories(repos);
        setIsLoadingRepos(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('Failed to load repositories in Code Explorer:', err);
        setIsLoadingRepos(false);
      });

    return () => {
      cancelled = true;
    };
  }, [repositories.length, setRepositories]);

  // Sync selected repository with URL query parameter ?repo=<id>
  useEffect(() => {
    if (!repositories.length) return;
    if (repoParam) {
      const match = repositories.find((r) => r._id === repoParam);
      if (match && match._id !== selectedRepo?._id) {
        setSelectedRepo(match);
      }
    } else if (!selectedRepo && repositories.length > 0) {
      setSelectedRepo(repositories[0]);
    }
  }, [repoParam, repositories, selectedRepo, setSelectedRepo]);

  // Load dev sample if ?sample=1 is provided
  const isSample = searchParams.has('sample');

  // Fetch analysis & atlas data for the active repository
  useEffect(() => {
    const ctrl = new AbortController();
    setIsLoadingData(true);
    setDataError(null);

    const loadData = async () => {
      try {
        let atlas: AtlasData | null = null;
        let issues: IArchitecturalIssue[] = [];
        let currentRepo: RepositorySummary | null = selectedRepo;

        if (isSample && import.meta.env.DEV) {
          const { default: sampleUrl } = await import('../features/atlas/sample/atlas-sample.json?url');
          const sampleRes = await fetch(sampleUrl);
          if (sampleRes.ok) {
            try {
              atlas = parseAtlasData(await sampleRes.json());
            } catch (err) {
              console.warn('Could not parse sample atlas:', err);
            }
          }
        } else {
          if (!currentRepo) {
            setIsLoadingData(false);
            return;
          }

          // Fetch atlas data and repo details in parallel
          const [atlasResult, detailsResult] = await Promise.allSettled([
            fetchAtlas(currentRepo._id, ctrl.signal),
            api.getRepositoryDetails(currentRepo._id),
          ]);

          if (atlasResult.status === 'fulfilled' && atlasResult.value) {
            if ('ok' in atlasResult.value) {
              atlas = atlasResult.value.ok ? atlasResult.value.data : null;
            } else {
              try {
                atlas = parseAtlasData(atlasResult.value);
              } catch {
                atlas = null;
              }
            }
          }

          if (detailsResult.status === 'fulfilled' && detailsResult.value.latestAnalysis) {
            issues = detailsResult.value.latestAnalysis.issues || [];
          }
        }

        if (ctrl.signal.aborted) return;

        // Build ExplorerFileItem index
        const itemMap = new Map<string, ExplorerFileItem>();
        const issuesByFile = new Map<string, IArchitecturalIssue[]>();

        for (const issue of issues) {
          const key = issue.file;
          if (!issuesByFile.has(key)) issuesByFile.set(key, []);
          issuesByFile.get(key)!.push(issue);
        }

        if (atlas) {
          // 1. Build from rich AtlasData
          const edges = atlas.edges || [];
          const outgoingByFrom = new Map<string, ExplorerDependency[]>();
          const incomingByTo = new Map<string, ExplorerDependent[]>();

          for (const edge of edges) {
            // Outgoing
            if (!outgoingByFrom.has(edge.from)) outgoingByFrom.set(edge.from, []);
            outgoingByFrom.get(edge.from)!.push({
              specifier: edge.specifier || edge.to || 'unknown',
              resolvedPath: edge.to,
              isLocal: edge.status === 'resolved' && Boolean(edge.to),
              isExternal: edge.status === 'external',
              isBuiltin: edge.reason === 'built-in module',
              line: edge.line,
              kind: edge.kind,
              reason: edge.reason,
            });

            // Incoming (dependents)
            if (edge.to) {
              if (!incomingByTo.has(edge.to)) incomingByTo.set(edge.to, []);
              const fromName = edge.from.split('/').pop() || edge.from;
              const fromFolder = edge.from.includes('/') ? edge.from.slice(0, edge.from.lastIndexOf('/')) : '';
              incomingByTo.get(edge.to)!.push({
                path: edge.from,
                name: fromName,
                folder: fromFolder,
                line: edge.line,
              });
            }
          }

          for (const f of atlas.files) {
            const item: ExplorerFileItem = {
              path: f.path,
              name: f.name,
              ext: f.ext,
              folder: f.folder,
              size: f.size,
              lines: f.lines,
              kind: f.kind,
              language: f.ext ? f.ext.replace(/^\./, '').toUpperCase() : 'Other',
              functions: f.functions || [],
              exports: f.exports || [],
              complexity: f.complexity,
              tokens: f.tokens,
              parseError: f.parseError,
              outgoingDeps: outgoingByFrom.get(f.path) || [],
              incomingDeps: incomingByTo.get(f.path) || [],
              issues: issuesByFile.get(f.path) || [],
            };
            itemMap.set(f.path, item);
          }
        }

        const sortedList = [...itemMap.values()].sort((a, b) => a.path.localeCompare(b.path));
        setFileMap(itemMap);
        setFilesList(sortedList);
        setIsLoadingData(false);

        // Auto-open first file or file from URL
        let fileToOpen = pathParam && itemMap.has(pathParam) ? pathParam : null;
        if (!fileToOpen && sortedList.length > 0) {
          // Prefer entry point or first code file
          const entry =
            sortedList.find((f) => /^(?:index|app|main)\.[cm]?[jt]sx?$/i.test(f.name)) ||
            sortedList.find((f) => f.kind === 'code') ||
            sortedList[0];
          fileToOpen = entry ? entry.path : null;
        }

        if (fileToOpen) {
          const item = itemMap.get(fileToOpen)!;
          setOpenTabs([
            {
              id: item.path,
              path: item.path,
              name: item.name,
              ext: item.ext,
            },
          ]);
          setActiveTabId(item.path);

          // Expand folder path in tree
          setExpandedFolders(new Set(getAncestorPaths(item.path)));
        }

        if (lineParam) {
          const parsedLine = parseInt(lineParam, 10);
          if (!Number.isNaN(parsedLine) && parsedLine > 0) {
            setTargetLine(parsedLine);
            setTargetNonce((n) => n + 1);
          }
        }
      } catch (err: any) {
        if (!ctrl.signal.aborted) {
          setDataError(err?.message || 'Failed to load repository files.');
          setIsLoadingData(false);
        }
      }
    };

    loadData();

    return () => {
      ctrl.abort();
    };
  }, [selectedRepo?._id, isSample, pathParam, lineParam]);

  // Fetch source code for active tab
  const activeTab = useMemo(() => {
    return openTabs.find((t) => t.id === activeTabId) || null;
  }, [openTabs, activeTabId]);

  const currentFile = useMemo(() => {
    if (!activeTab) return null;
    return fileMap.get(activeTab.path) || null;
  }, [activeTab, fileMap]);

  useEffect(() => {
    if (!activeTab) {
      setSourceCode(null);
      setSourceError(null);
      setIsLoadingSource(false);
      return;
    }

    const ctrl = new AbortController();
    setIsLoadingSource(true);
    setSourceError(null);

    const loadSource = async () => {
      try {
        if (!selectedRepo) {
          setIsLoadingSource(false);
          return;
        }

        const commitSha = selectedRepo.commitSha || 'main';
        const res = await fetchFileSource(
          {
            owner: selectedRepo.owner,
            name: selectedRepo.name,
            source: selectedRepo.source,
          },
          activeTab.path,
          commitSha,
          { signal: ctrl.signal }
        );

        if (ctrl.signal.aborted) return;

        if (res.ok) {
          setSourceCode(res.text);
          setSourceError(null);
        } else {
          setSourceCode(null);
          setSourceError(res.message);
        }
      } catch (err: any) {
        if (!ctrl.signal.aborted) {
          setSourceCode(null);
          setSourceError(err?.message || 'Could not load file source code.');
        }
      } finally {
        if (!ctrl.signal.aborted) {
          setIsLoadingSource(false);
        }
      }
    };

    loadSource();

    return () => {
      ctrl.abort();
    };
  }, [activeTab?.path, selectedRepo]);

  // Inspect source code for bugs, dead code, and security vulnerabilities
  useEffect(() => {
    if (!sourceCode || !activeTab) {
      setFileIssues([]);
      setIsLoadingInspection(false);
      return;
    }

    let cancelled = false;
    setIsLoadingInspection(true);

    api
      .inspectSnippet(sourceCode, activeTab.path)
      .then((res) => {
        if (cancelled) return;
        setFileIssues(res.issues || []);
        setIsLoadingInspection(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('Failed to run code inspection on snippet:', err);
        setFileIssues([]);
        setIsLoadingInspection(false);
      });

    return () => {
      cancelled = true;
    };
  }, [sourceCode, activeTab?.path]);

  // Run AI deep logic inspection
  const handleRunAiInspection = useCallback(async () => {
    if (!selectedRepo || !activeTab || !sourceCode || isAiInspecting) return;
    setIsAiInspecting(true);

    try {
      const prompt = `Perform an intelligent code quality and bug audit on the file: "${activeTab.path}".
Source code snippet:
\`\`\`${activeTab.ext || 'ts'}
${sourceCode.slice(0, 4000)}
\`\`\`
Identify any subtle logical errors, edge case bugs, memory/resource leaks, or security vulnerabilities.
Respond strictly in JSON format:
{
  "issues": [
    {
      "message": "Concise issue description",
      "explanation": "Detailed explanation of the potential risk or bug",
      "line": 1,
      "severity": "warning",
      "suggestedFix": "Code fix or advice"
    }
  ]
}`;

      const res = await api.askAssistant(selectedRepo._id, {
        question: prompt,
        path: activeTab.path,
        context: sourceCode.slice(0, 3000),
      });
      const jsonMatch = res.answer.match(/\{[\s\S]*"issues"[\s\S]*\}/);

      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (Array.isArray(parsed.issues) && parsed.issues.length > 0) {
          const aiIssues: CodeIssue[] = parsed.issues.map((iss: any, idx: number) => ({
            id: `ai-${Date.now()}-${idx}`,
            ruleId: 'ai-code-auditor',
            ruleName: 'AI Logic Inspection',
            category: 'ai_detected' as const,
            severity: iss.severity === 'error' ? ('error' as const) : ('warning' as const),
            confidence: 'heuristic' as const,
            file: activeTab.path,
            line: typeof iss.line === 'number' && iss.line > 0 ? iss.line : 1,
            message: iss.message || 'Potential issue detected by AI auditor',
            explanation: iss.explanation || res.answer,
            suggestedFix: iss.suggestedFix,
          }));
          setFileIssues((prev) => [...prev, ...aiIssues]);
          setIsProblemsOpen(true);
        }
      } else {
        const aiIssue: CodeIssue = {
          id: `ai-${Date.now()}-0`,
          ruleId: 'ai-code-auditor',
          ruleName: 'AI Logic Inspection',
          category: 'ai_detected' as const,
          severity: 'info' as const,
          confidence: 'heuristic' as const,
          file: activeTab.path,
          line: 1,
          message: 'AI Code Analysis completed',
          explanation: res.answer,
        };
        setFileIssues((prev) => [...prev, aiIssue]);
        setIsProblemsOpen(true);
      }
    } catch (err) {
      console.error('Failed to run AI inspection:', err);
    } finally {
      setIsAiInspecting(false);
    }
  }, [selectedRepo, activeTab, sourceCode, isAiInspecting]);

  const handleSelectIssue = useCallback((issue: CodeIssue) => {
    setTargetLine(issue.line);
    setTargetNonce((n) => n + 1);
  }, []);

  // Handlers for File Selection & Tabs
  const handleOpenFile = useCallback(
    (filePath: string, line?: number) => {
      const file = fileMap.get(filePath);
      if (!file) return;

      // 1. Expand tree to this file
      setExpandedFolders((prev) => {
        const next = new Set(prev);
        for (const p of getAncestorPaths(filePath)) next.add(p);
        return next;
      });

      // 2. Open or switch tab
      setOpenTabs((prev) => {
        if (prev.some((t) => t.id === filePath)) {
          return prev;
        }
        return [
          ...prev,
          {
            id: file.path,
            path: file.path,
            name: file.name,
            ext: file.ext,
          },
        ];
      });

      setActiveTabId(filePath);

      // 3. Scroll to target line if provided
      if (line) {
        setTargetLine(line);
        setTargetNonce((n) => n + 1);
      } else {
        setTargetLine(null);
      }

      // 4. Update URL cleanly without full reload
      const newParams = new URLSearchParams(searchParams);
      newParams.set('path', filePath);
      if (line) newParams.set('line', String(line));
      else newParams.delete('line');
      setSearchParams(newParams, { replace: true });
    },
    [fileMap, searchParams, setSearchParams]
  );

  const handleCloseTab = useCallback(
    (id: string) => {
      setOpenTabs((prev) => {
        const next = prev.filter((t) => t.id !== id);
        if (activeTabId === id) {
          const nextActive = next.length > 0 ? next[next.length - 1].id : null;
          setActiveTabId(nextActive);
          if (nextActive) {
            const newParams = new URLSearchParams(searchParams);
            newParams.set('path', nextActive);
            newParams.delete('line');
            setSearchParams(newParams, { replace: true });
          }
        }
        return next;
      });
    },
    [activeTabId, searchParams, setSearchParams]
  );

  const handleToggleFolder = useCallback((folderPath: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderPath)) {
        next.delete(folderPath);
      } else {
        next.add(folderPath);
      }
      return next;
    });
  }, []);

  const handleExpandAll = useCallback(() => {
    const all = new Set<string>();
    for (const f of filesList) {
      for (const p of getAncestorPaths(f.path)) all.add(p);
    }
    setExpandedFolders(all);
  }, [filesList]);

  const handleCollapseAll = useCallback(() => {
    setExpandedFolders(new Set(['']));
  }, []);

  const handleSelectRepo = useCallback(
    (repo: RepositorySummary) => {
      setSelectedRepo(repo);
      setOpenTabs([]);
      setActiveTabId(null);
      setSourceCode(null);
      setSourceError(null);
      const newParams = new URLSearchParams();
      newParams.set('repo', repo._id);
      setSearchParams(newParams);
    },
    [setSelectedRepo, setSearchParams]
  );

  return (
    <div className="explorer-container">
      {/* Top Header Bar */}
      <header className="explorer-header">
        <div className="explorer-header-left">
          <div className="explorer-breadcrumb">
            <Link to="/home" className="explorer-breadcrumb-link" title="Return to Home">
              <ChevronLeft size={14} /> / Code Explorer
            </Link>
          </div>
          <h1 className="explorer-title">Code Explorer</h1>
          <p className="explorer-subtitle">
            Browse, search, and understand your codebase with AI-powered insights.
          </p>
        </div>

        <div className="explorer-header-controls">
          {/* Top Search Bar */}
          <TopSearchBar files={filesList} onSelectResult={handleOpenFile} />

          {/* Repository Selector Dropdown */}
          <RepoSelectorDropdown
            repositories={repositories}
            selectedRepo={selectedRepo}
            onSelectRepo={handleSelectRepo}
          />
        </div>
      </header>

      {/* Main 3-Column Explorer Layout */}
      {isLoadingData || isLoadingRepos ? (
        <div
          style={{
            minHeight: '60vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            color: '#8B78FF',
          }}
        >
          <div className="spin" style={{ display: 'grid', placeItems: 'center' }}>
            <RefreshCw size={28} />
          </div>
          <div style={{ fontSize: 13, color: '#A7B4CC' }}>Loading repository code structure…</div>
        </div>
      ) : dataError ? (
        <div
          style={{
            minHeight: '50vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            padding: 24,
            textAlign: 'center',
          }}
        >
          <AlertCircle size={32} color="#FF717A" />
          <div style={{ fontSize: 16, fontWeight: 600, color: '#F3F6FF' }}>Unable to load repository data</div>
          <div style={{ fontSize: 13, color: '#A7B4CC', maxWidth: 440 }}>{dataError}</div>
          <button
            type="button"
            className="auth-btn"
            style={{ marginTop: 12, width: 'auto', padding: '8px 20px' }}
            onClick={() => window.location.reload()}
          >
            Retry Loading
          </button>
        </div>
      ) : (
        <div className={`explorer-columns ${isFullscreen ? 'fullscreen-active' : ''}`}>
          {/* Column 1: Left Panel - Repository Files Tree */}
          {!isFullscreen && (
            <FileTreePanel
              files={filesList}
              selectedPath={activeTab?.path || null}
              onSelectFile={handleOpenFile}
              expandedFolders={expandedFolders}
              onToggleFolder={handleToggleFolder}
              onExpandAll={handleExpandAll}
              onCollapseAll={handleCollapseAll}
            />
          )}

          {/* Column 2: Center Panel - Source Code Viewer */}
          <SourceViewerPanel
            tabs={openTabs}
            activeTabId={activeTabId}
            onSelectTab={(id) => {
              setActiveTabId(id);
              const newParams = new URLSearchParams(searchParams);
              newParams.set('path', id);
              newParams.delete('line');
              setSearchParams(newParams, { replace: true });
            }}
            onCloseTab={handleCloseTab}
            onNewTabClick={() => {
              // Focus top search bar
              const searchEl = document.querySelector<HTMLInputElement>('.explorer-search-input');
              searchEl?.focus();
            }}
            currentFile={currentFile}
            sourceCode={sourceCode}
            isLoadingSource={isLoadingSource}
            sourceError={sourceError}
            isFullscreen={isFullscreen}
            onToggleFullscreen={() => setIsFullscreen(!isFullscreen)}
            targetLine={targetLine}
            targetNonce={targetNonce}
            issues={fileIssues}
            isLoadingIssues={isLoadingInspection}
            isAiInspecting={isAiInspecting}
            isProblemsOpen={isProblemsOpen}
            onToggleProblems={() => setIsProblemsOpen(!isProblemsOpen)}
            onSelectIssue={handleSelectIssue}
            onRunAiInspection={handleRunAiInspection}
          />

          {/* Column 3: Right Panel - Contextual AI Summary & Metrics */}
          {!isFullscreen && (
            <ContextPanel
              currentFile={currentFile}
              sourceCode={sourceCode}
              onNavigateToFile={handleOpenFile}
              issues={fileIssues}
              onSelectLine={(line) => {
                setTargetLine(line);
                setTargetNonce((n) => n + 1);
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}
