import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { Home, Search, Loader2, AlertCircle, RefreshCw, FileText } from 'lucide-react';
import '../features/reports/reports.css';
import { useRepositoryStore } from '../context/repositoryStore';
import { api, type RepositorySummary, type AnalysisDetails } from '../lib/api';
import { fetchAtlas } from '../features/atlas/atlasApi';
import { parseAtlasData, type AtlasData } from '../features/atlas/model';
import { RepoSelectorDropdown } from '../features/explorer/RepoSelectorDropdown';
import type { ReportTabId } from '../features/reports/reportsTypes';
import {
  calculateKpis,
  calculateCodebaseComposition,
  calculateProjectStructure,
  calculateKeyMetricsSeries,
  deriveBenchmarkData,
  deriveReportInsights,
} from '../features/reports/reportsCalculation';
import { OverviewTab } from '../features/reports/OverviewTab';
import { BenchmarksTab } from '../features/reports/BenchmarksTab';
import { DetailedReportTab } from '../features/reports/DetailedReportTab';
import { ExportTab } from '../features/reports/ExportTab';
import { PrintableReportModal } from '../features/reports/PrintableReportModal';

export default function ReportsBenchmarks() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const { repositories, selectedRepo, setRepositories, setSelectedRepo } = useRepositoryStore();

  const [isLoadingRepos, setIsLoadingRepos] = useState(repositories.length === 0);
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);

  // Active navigation tab
  const [activeTab, setActiveTab] = useState<ReportTabId>('overview');

  // Search input
  const [searchQuery, setSearchQuery] = useState('');

  // Data
  const [repoDetails, setRepoDetails] = useState<any>(null);
  const [analysis, setAnalysis] = useState<AnalysisDetails | null>(null);
  const [atlas, setAtlas] = useState<AtlasData | null>(null);

  // Printable Modal
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);

  // Query parameter ?repo=<id>
  const repoParam = searchParams.get('repo');
  const tabParam = searchParams.get('tab') as ReportTabId | null;

  useEffect(() => {
    if (tabParam && ['overview', 'benchmarks', 'detailed', 'export'].includes(tabParam)) {
      setActiveTab(tabParam);
    }
  }, [tabParam]);

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
        console.error('Failed to load repositories in Reports & Benchmarks:', err);
        setIsLoadingRepos(false);
      });

    return () => {
      cancelled = true;
    };
  }, [repositories.length, setRepositories]);

  // Sync selected repository with URL query parameter
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

  // Handle repository selection from dropdown
  const handleSelectRepo = useCallback(
    (repo: RepositorySummary) => {
      setSelectedRepo(repo);
      setSearchParams({ repo: repo._id, tab: activeTab });
    },
    [setSelectedRepo, setSearchParams, activeTab]
  );

  const handleTabChange = (tab: ReportTabId) => {
    setActiveTab(tab);
    setSearchParams({ repo: selectedRepo?._id || '', tab });
  };

  // Fetch analysis & atlas data for the active repository
  const loadRepositoryData = useCallback(async () => {
    if (!selectedRepo) return;
    setIsLoadingData(true);
    setDataError(null);

    try {
      const [detailsRes, atlasRes] = await Promise.allSettled([
        api.getRepositoryDetails(selectedRepo._id),
        fetchAtlas(selectedRepo._id),
      ]);

      if (detailsRes.status === 'fulfilled') {
        const d = detailsRes.value;
        setRepoDetails(d);
        if (d.latestAnalysis) {
          setAnalysis(d.latestAnalysis);
        } else {
          setAnalysis(null);
        }
      } else {
        console.warn('Could not load repository details for reports:', detailsRes.reason);
      }

      if (atlasRes.status === 'fulfilled' && atlasRes.value) {
        if ('ok' in atlasRes.value) {
          setAtlas(atlasRes.value.ok ? atlasRes.value.data : null);
        } else {
          try {
            setAtlas(parseAtlasData(atlasRes.value));
          } catch {
            setAtlas(null);
          }
        }
      } else {
        setAtlas(null);
      }
    } catch (err: any) {
      console.error('Error loading reports & benchmarks data:', err);
      setDataError(err.message || 'Failed to load repository report data');
    } finally {
      setIsLoadingData(false);
    }
  }, [selectedRepo]);

  useEffect(() => {
    loadRepositoryData();
  }, [loadRepositoryData]);

  // Derived Models
  const kpis = useMemo(
    () => calculateKpis(selectedRepo, analysis, repoDetails?.analysisHistory || []),
    [selectedRepo, analysis, repoDetails]
  );

  const composition = useMemo(
    () => calculateCodebaseComposition(analysis),
    [analysis]
  );

  const structureNodes = useMemo(
    () => calculateProjectStructure(analysis, atlas),
    [analysis, atlas]
  );

  const keyMetrics = useMemo(
    () => calculateKeyMetricsSeries(selectedRepo, analysis),
    [selectedRepo, analysis]
  );

  const benchmarks = useMemo(
    () => deriveBenchmarkData(selectedRepo, analysis, repositories, true),
    [selectedRepo, analysis, repositories]
  );

  const insights = useMemo(
    () => deriveReportInsights(analysis, atlas),
    [analysis, atlas]
  );

  return (
    <div className="reports-page-container">
      {/* Top Header Row */}
      <header className="reports-header-row">
        <div className="reports-header-left">
          <nav className="reports-breadcrumb" aria-label="Breadcrumb">
            <Link to="/home">
              <Home size={14} />
            </Link>
            <span style={{ opacity: 0.5 }}>/</span>
            <span style={{ color: 'var(--color-text-secondary)' }}>Reports & Benchmarks</span>
          </nav>
          <h1 className="reports-title">Reports & Benchmarks</h1>
          <p className="reports-subtitle">
            Get detailed insights about this repository and compare it with others.
          </p>
        </div>

        <div className="reports-header-right">
          {/* Search box */}
          <div className="health-search-wrapper" style={{ width: 300 }}>
            <Search size={15} className="health-search-icon" />
            <input
              type="text"
              className="health-search-input"
              placeholder="Search files, folders, or insights..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search reports"
            />
          </div>

          {/* Repository Selector */}
          <RepoSelectorDropdown
            repositories={repositories}
            selectedRepo={selectedRepo}
            onSelectRepo={handleSelectRepo}
          />
        </div>
      </header>

      {/* Tabs & Action Bar */}
      <div className="reports-tabs-bar">
        <div className="reports-nav-pills" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'overview'}
            className={`reports-nav-pill-btn ${activeTab === 'overview' ? 'active' : ''}`}
            onClick={() => handleTabChange('overview')}
          >
            Overview
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'benchmarks'}
            className={`reports-nav-pill-btn ${activeTab === 'benchmarks' ? 'active' : ''}`}
            onClick={() => handleTabChange('benchmarks')}
          >
            Benchmarks
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'detailed'}
            className={`reports-nav-pill-btn ${activeTab === 'detailed' ? 'active' : ''}`}
            onClick={() => handleTabChange('detailed')}
          >
            Detailed Report
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'export'}
            className={`reports-nav-pill-btn ${activeTab === 'export' ? 'active' : ''}`}
            onClick={() => handleTabChange('export')}
          >
            Export
          </button>
        </div>

        <button
          type="button"
          className="reports-primary-action-btn"
          onClick={() => setIsPrintModalOpen(true)}
          title="Generate print-ready formatted PDF report"
        >
          <FileText size={16} />
          <span>Generate Full PDF Report</span>
        </button>
      </div>

      {/* Main Content Area */}
      {isLoadingData || isLoadingRepos ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 450,
            gap: 16,
            color: 'var(--color-text-supporting)',
          }}
        >
          <Loader2 size={36} className="spin" color="#386BFF" style={{ animation: 'spin 1.5s linear infinite' }} />
          <div style={{ fontSize: 14 }}>Aggregating repository telemetry & metrics...</div>
        </div>
      ) : dataError ? (
        <div
          style={{
            padding: 40,
            textAlign: 'center',
            background: 'rgba(8, 14, 30, 0.7)',
            borderRadius: 'var(--radius-card)',
            border: '1px solid rgba(255, 113, 122, 0.3)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <AlertCircle size={32} color="#FF717A" />
          <h2 style={{ fontSize: 18, color: '#F3F6FF', margin: 0 }}>Error Loading Repository</h2>
          <p style={{ color: 'var(--color-text-supporting)', margin: 0 }}>{dataError}</p>
          <button
            type="button"
            className="reports-primary-action-btn"
            onClick={loadRepositoryData}
            style={{ marginTop: 8 }}
          >
            <RefreshCw size={14} />
            <span>Retry Loading</span>
          </button>
        </div>
      ) : !selectedRepo ? (
        <div
          style={{
            padding: 48,
            textAlign: 'center',
            background: 'rgba(8, 14, 30, 0.7)',
            borderRadius: 'var(--radius-card)',
            border: '1px solid rgba(135, 155, 255, 0.16)',
            color: 'var(--color-text-supporting)',
          }}
        >
          <h2 style={{ fontSize: 18, color: '#F3F6FF', marginBottom: 8 }}>No Repository Selected</h2>
          <p>Please select a repository from the selector above to inspect reports and benchmarks.</p>
        </div>
      ) : (
        <main>
          {activeTab === 'overview' && (
            <OverviewTab
              kpis={kpis}
              composition={composition}
              structureNodes={structureNodes}
              keyMetrics={keyMetrics}
              benchmarks={benchmarks}
              insights={insights}
              repoId={selectedRepo._id}
              onOpenBenchmarksTab={() => handleTabChange('benchmarks')}
              onOpenDetailedReportTab={() => handleTabChange('detailed')}
            />
          )}

          {activeTab === 'benchmarks' && (
            <BenchmarksTab
              currentRepo={selectedRepo}
              benchmarks={benchmarks}
              availableRepos={repositories}
            />
          )}

          {activeTab === 'detailed' && (
            <DetailedReportTab
              repo={selectedRepo}
              analysis={analysis}
              kpis={kpis}
              composition={composition}
              structure={structureNodes}
              insights={insights}
            />
          )}

          {activeTab === 'export' && (
            <ExportTab
              repo={selectedRepo}
              analysis={analysis}
              kpis={kpis}
              composition={composition}
              structure={structureNodes}
              benchmarks={benchmarks}
              insights={insights}
              onTriggerPrint={() => setIsPrintModalOpen(true)}
            />
          )}
        </main>
      )}

      {/* Printable Report Modal */}
      <PrintableReportModal
        isOpen={isPrintModalOpen}
        onClose={() => setIsPrintModalOpen(false)}
        repo={selectedRepo}
        analysis={analysis}
        kpis={kpis}
        composition={composition}
        structure={structureNodes}
        benchmarks={benchmarks}
        insights={insights}
      />
    </div>
  );
}
