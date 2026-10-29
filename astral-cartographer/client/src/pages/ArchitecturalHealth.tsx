import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { Home, Search, AlertCircle, RefreshCw, Loader2 } from 'lucide-react';
import '../features/health/health.css';
import { useRepositoryStore } from '../context/repositoryStore';
import { api, type RepositorySummary, type AnalysisDetails } from '../lib/api';
import { fetchAtlas } from '../features/atlas/atlasApi';
import { parseAtlasData, type AtlasData } from '../features/atlas/model';
import { RepoSelectorDropdown } from '../features/explorer/RepoSelectorDropdown';
import { HealthScoreCard } from '../features/health/HealthScoreCard';
import { KeyMetricsGrid } from '../features/health/KeyMetricsGrid';
import { IssuesOverviewCard } from '../features/health/IssuesOverviewCard';
import { MaintainabilityTrendsCard } from '../features/health/MaintainabilityTrendsCard';
import { ComplexityDistributionCard } from '../features/health/ComplexityDistributionCard';
import { TopRiskAreasCard } from '../features/health/TopRiskAreasCard';
import { RecommendationsCard } from '../features/health/RecommendationsCard';
import { FileTypeBreakdownCard } from '../features/health/FileTypeBreakdownCard';
import { CodeQualityCard } from '../features/health/CodeQualityCard';
import { FindingsModal } from '../features/health/FindingsModal';
import { FullReportModal } from '../features/health/FullReportModal';
import {
  calculateHealthScore,
  getIssuesBySeverity,
  calculateComplexityBuckets,
  deriveRiskAreas,
  deriveRecommendations,
  deriveHistoricalTrends,
} from '../features/health/healthCalculation';
import type { ComplexityBucket, SeverityLevel } from '../features/health/healthTypes';

export default function ArchitecturalHealth() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const { repositories, selectedRepo, setRepositories, setSelectedRepo } = useRepositoryStore();

  const [isLoadingRepos, setIsLoadingRepos] = useState(repositories.length === 0);
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);

  // Repository details and atlas
  const [repoDetails, setRepoDetails] = useState<any>(null);
  const [analysis, setAnalysis] = useState<AnalysisDetails | null>(null);
  const [atlas, setAtlas] = useState<AtlasData | null>(null);

  // Global search input
  const [headerSearch, setHeaderSearch] = useState('');

  // Modals state
  const [isFindingsModalOpen, setIsFindingsModalOpen] = useState(false);
  const [findingsModalSeverity, setFindingsModalSeverity] = useState<SeverityLevel | 'all'>('all');
  const [selectedComplexityBucket, setSelectedComplexityBucket] = useState<ComplexityBucket | null>(null);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);

  // Determine current active repository from query parameter ?repo=<id>
  const repoParam = searchParams.get('repo');

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
        console.error('Failed to load repositories in Architectural Health:', err);
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
      setSearchParams({ repo: repo._id });
    },
    [setSelectedRepo, setSearchParams]
  );

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
        console.warn('Could not load repository details:', detailsRes.reason);
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
      console.error('Error loading architectural health data:', err);
      setDataError(err.message || 'Failed to load architectural health data');
    } finally {
      setIsLoadingData(false);
    }
  }, [selectedRepo]);

  useEffect(() => {
    loadRepositoryData();
  }, [loadRepositoryData]);

  // Derived Calculations
  const scoreResult = useMemo(() => calculateHealthScore(analysis, atlas), [analysis, atlas]);
  const categories = useMemo(() => getIssuesBySeverity(analysis?.issues || []), [analysis]);
  const complexityBuckets = useMemo(() => calculateComplexityBuckets(atlas, analysis), [atlas, analysis]);
  const risks = useMemo(() => deriveRiskAreas(analysis), [analysis]);
  const recommendations = useMemo(() => deriveRecommendations(analysis, atlas), [analysis, atlas]);
  const trendPoints = useMemo(
    () => deriveHistoricalTrends(repoDetails?.analysisHistory || []),
    [repoDetails]
  );

  // Handlers for modal interactions
  const handleSelectSeverity = (severity: SeverityLevel) => {
    setSelectedComplexityBucket(null);
    setFindingsModalSeverity(severity);
    setIsFindingsModalOpen(true);
  };

  const handleSelectComplexityBucket = (bucket: ComplexityBucket) => {
    setSelectedComplexityBucket(bucket);
    setIsFindingsModalOpen(true);
  };

  const handleViewAllRisks = () => {
    setSelectedComplexityBucket(null);
    setFindingsModalSeverity('all');
    setIsFindingsModalOpen(true);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!headerSearch.trim()) return;
    setSelectedComplexityBucket(null);
    setFindingsModalSeverity('all');
    setIsFindingsModalOpen(true);
  };

  return (
    <div className="health-page-container">
      {/* Top Header Row */}
      <header className="health-header-row">
        <div className="health-header-left">
          <nav className="health-breadcrumb" aria-label="Breadcrumb">
            <Link to="/home">
              <Home size={14} />
            </Link>
            <span className="health-breadcrumb-separator">/</span>
            <span className="health-breadcrumb-current">Architectural Health</span>
          </nav>
          <h1 className="health-title">Architectural Health</h1>
          <p className="health-subtitle">
            Understand the health, risks, and structure of your codebase with AI-powered insights.
          </p>
        </div>

        <div className="health-header-right">
          {/* Search field */}
          <form className="health-search-wrapper" onSubmit={handleSearchSubmit}>
            <Search size={15} className="health-search-icon" />
            <input
              type="text"
              className="health-search-input"
              placeholder="Search files, folders, or functions..."
              value={headerSearch}
              onChange={(e) => setHeaderSearch(e.target.value)}
              aria-label="Search files, folders, or functions"
            />
          </form>

          {/* Repository Selector */}
          <RepoSelectorDropdown
            repositories={repositories}
            selectedRepo={selectedRepo}
            onSelectRepo={handleSelectRepo}
          />
        </div>
      </header>

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
          <div style={{ fontSize: 14 }}>Analyzing repository architecture...</div>
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
            className="recommendations-header-btn"
            onClick={loadRepositoryData}
            style={{ marginTop: 8 }}
          >
            <RefreshCw size={14} />
            <span>Retry Analysis</span>
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
          <p>Please select or connect a repository from the selector above to inspect architectural health.</p>
        </div>
      ) : (
        /* Dashboard 8-Card Responsive Grid */
        <main className="health-dashboard-grid">
          {/* Row 1: Overall Health Score, Key Metrics, Issues Overview */}
          <HealthScoreCard scoreResult={scoreResult} />
          <KeyMetricsGrid analysis={analysis} atlas={atlas} />
          <IssuesOverviewCard
            categories={categories}
            onSelectSeverity={handleSelectSeverity}
          />

          {/* Row 2: Maintainability Trends, Complexity Distribution, Top Risk Areas */}
          <MaintainabilityTrendsCard trendPoints={trendPoints} />
          <ComplexityDistributionCard
            buckets={complexityBuckets}
            onSelectBucket={handleSelectComplexityBucket}
          />
          <TopRiskAreasCard
            risks={risks}
            repoId={selectedRepo._id}
            onViewAll={handleViewAllRisks}
          />

          {/* Row 3: Architectural Insights & Recommendations, File Type Breakdown */}
          <RecommendationsCard
            recommendations={recommendations}
            repoId={selectedRepo._id}
            onGenerateReport={() => setIsReportModalOpen(true)}
          />
          <FileTypeBreakdownCard
            analysis={analysis}
            onSelectLanguage={(lang) => {
              setHeaderSearch(lang);
              setIsFindingsModalOpen(true);
            }}
          />

          {/* Row 4: Code Quality & Bug Inspection (AST & Static Issues) */}
          <CodeQualityCard
            codeIssues={analysis?.codeIssues || []}
            codeIssuesSummary={analysis?.codeIssuesSummary}
            repoId={selectedRepo._id}
          />
        </main>
      )}

      {/* Findings Inspection Modal */}
      <FindingsModal
        isOpen={isFindingsModalOpen}
        onClose={() => setIsFindingsModalOpen(false)}
        issues={analysis?.issues || []}
        initialSeverity={findingsModalSeverity}
        complexityBucket={selectedComplexityBucket}
        repoId={selectedRepo?._id}
      />

      {/* Full Report Export Modal */}
      <FullReportModal
        isOpen={isReportModalOpen}
        onClose={() => setIsReportModalOpen(false)}
        selectedRepo={selectedRepo}
        analysis={analysis}
        scoreResult={scoreResult}
        categories={categories}
        recommendations={recommendations}
      />
    </div>
  );
}
