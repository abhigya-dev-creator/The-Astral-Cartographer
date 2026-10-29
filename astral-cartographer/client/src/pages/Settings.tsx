import React, { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Home,
  Key,
  Eye,
  EyeOff,
  RefreshCw,
  Sliders,
  Code2,
  User,
  Database,
  Activity,
  Check,
  AlertCircle,
  ExternalLink,
  Trash2,
  RotateCcw,
  Plus,
  X,
  Copy,
  LogOut,
  Sparkles,
  Server,
  Network,
} from 'lucide-react';
import { useSettings, excludePatternProblem } from '../context/settingsStore';
import { api, type GitHubRateLimit, type SystemInfo } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useRepositoryStore } from '../context/repositoryStore';
import CodeViewer from '../components/CodeViewer';
import '../features/settings/settings.css';

type SettingsTab = 'github' | 'analyzer' | 'visualizer' | 'account' | 'storage' | 'system';

interface SystemHealthData {
  backend: 'ok' | 'degraded' | 'error' | 'checking';
  backendLatency?: number;
  database: 'connected' | 'disconnected' | 'memory' | 'checking';
  databaseMode?: string;
  supabase: 'connected' | 'not-configured' | 'error';
  lastChecked: number | null;
}

export default function Settings() {
  const navigate = useNavigate();
  const settings = useSettings();
  const { user, signOut, isConfigured: isSupabaseConfigured } = useAuth();
  const { repositories } = useRepositoryStore();

  const [activeTab, setActiveTab] = useState<SettingsTab>('github');
  const [newPatternInput, setNewPatternInput] = useState('');
  const [patternError, setPatternError] = useState<string | null>(null);
  const [sysInfo, setSysInfo] = useState<SystemInfo | null>(null);
  const [sysInfoError, setSysInfoError] = useState<string | null>(null);
  const [ghStatus, setGhStatus] = useState<GitHubRateLimit | null>(null);
  const [ghLoading, setGhLoading] = useState(false);

  // real analysis limits and language support from the server
  useEffect(() => {
    api.getSystemInfo().then(setSysInfo).catch((err) => setSysInfoError(err?.message || 'Could not load server information.'));
  }, []);
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Modals
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    body: string;
    action: () => void;
  } | null>(null);

  // System Health state
  const [systemHealth, setSystemHealth] = useState<SystemHealthData>({
    backend: 'checking',
    database: 'checking',
    supabase: isSupabaseConfigured ? 'connected' : 'not-configured',
    lastChecked: null,
  });

  // Calculate local storage size
  const [storageUsage, setStorageUsage] = useState<{ bytes: number; formatted: string }>({
    bytes: 0,
    formatted: '0 KB',
  });

  const triggerToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => {
      setToastMessage(null);
    }, 3500);
  };

  const calculateStorage = () => {
    try {
      let total = 0;
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) {
          const val = localStorage.getItem(key) || '';
          total += (key.length + val.length) * 2;
        }
      }
      const kb = total / 1024;
      const formatted = kb >= 1024 ? `${(kb / 1024).toFixed(2)} MB` : `${kb.toFixed(1)} KB`;
      setStorageUsage({ bytes: total, formatted });
    } catch {
      setStorageUsage({ bytes: 0, formatted: 'Unknown' });
    }
  };

  useEffect(() => {
    calculateStorage();
  }, [settings]);

  // Ping backend health
  const checkHealth = async () => {
    setSystemHealth((prev) => ({ ...prev, backend: 'checking', database: 'checking' }));
    const start = performance.now();
    try {
      const res = await fetch('/api/health');
      const latency = Math.round(performance.now() - start);
      if (res.ok) {
        const data = await res.json();
        setSystemHealth({
          backend: 'ok',
          backendLatency: latency,
          database: data.database?.connected ? (data.database?.mode === 'in-memory' ? 'memory' : 'connected') : 'disconnected',
          databaseMode: data.database?.mode,
          supabase: isSupabaseConfigured ? 'connected' : 'not-configured',
          lastChecked: Date.now(),
        });
      } else {
        setSystemHealth({
          backend: 'degraded',
          backendLatency: latency,
          database: 'disconnected',
          supabase: isSupabaseConfigured ? 'connected' : 'not-configured',
          lastChecked: Date.now(),
        });
      }
    } catch {
      setSystemHealth({
        backend: 'error',
        database: 'disconnected',
        supabase: isSupabaseConfigured ? 'connected' : 'not-configured',
        lastChecked: Date.now(),
      });
    }
  };

  useEffect(() => {
    checkHealth();
  }, []);

  // GitHub rate limit of the credentials the server uses for imports (its GITHUB_TOKEN, or anonymous)
  const checkGitHub = async () => {
    setGhLoading(true);
    try {
      setGhStatus(await api.getGitHubRateLimit());
    } catch (err: any) {
      triggerToast(err?.message || 'Could not check the GitHub rate limit', 'error');
    } finally {
      setGhLoading(false);
    }
  };

  // Add an excluded pattern (validated with the same rules as the server)
  const handleAddPattern = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const problem = excludePatternProblem(newPatternInput);
    if (problem) { setPatternError(problem); return; }
    settings.addExcludedPattern(newPatternInput);
    setNewPatternInput('');
    setPatternError(null);
    triggerToast('Pattern added. It applies to the next analysis you start.');
  };

  // Clear Local Cache
  const handleClearCache = () => {
    setConfirmModal({
      isOpen: true,
      title: 'Clear Local Cache?',
      body: 'This removes view preferences this browser remembers (for example panel sizes). Your settings, your sign-in and everything stored on the server stay as they are.',
      action: () => {
        try {
          const keysToRemove: string[] = [];
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && !key.startsWith('astral_cartographer_settings') && !key.startsWith('sb-')) {
              keysToRemove.push(key);
            }
          }
          keysToRemove.forEach((k) => localStorage.removeItem(k));
          calculateStorage();
          triggerToast('Local cache cleared successfully.');
        } catch {
          triggerToast('Failed to clear local cache', 'error');
        }
        setConfirmModal(null);
      },
    });
  };

  // Reset to Defaults
  const handleResetDefaults = () => {
    setConfirmModal({
      isOpen: true,
      title: 'Reset All Settings to Defaults?',
      body: 'This removes your excluded patterns and resets the editor preferences to their defaults. Your repositories and analyses on the server are not affected.',
      action: () => {
        settings.resetToDefaults();
        triggerToast('All settings restored to defaults.');
        setConfirmModal(null);
      },
    });
  };

  // User details
  const avatarUrl = user?.user_metadata?.avatar_url || user?.user_metadata?.picture;
  const displayName =
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    user?.user_metadata?.user_name ||
    user?.email?.split('@')[0] ||
    'Cartographer';
  const initial = displayName.charAt(0).toUpperCase();

  const handleSignOut = async () => {
    await signOut();
    navigate('/auth');
  };

  // Sample code for live preview
  const sampleCode = `// Astral Cartographer Live Editor Preview
export interface RepositoryNode {
  id: string;
  name: string;
  functions: number;
}

export function calculateMetrics(nodes: RepositoryNode[]): number {
  return nodes.reduce((acc, curr) => acc + curr.functions, 0);
}`;

  return (
    <div className="settings-page-container">
      {/* Top Header Row */}
      <header className="settings-header-row">
        <div className="settings-header-left">
          <nav className="settings-breadcrumb" aria-label="Breadcrumb">
            <Link to="/home">
              <Home size={14} />
            </Link>
            <span style={{ opacity: 0.5 }}>/</span>
            <span style={{ color: 'var(--color-text-secondary)' }}>Settings</span>
          </nav>
          <h1 className="settings-title">Settings</h1>
          <p className="settings-subtitle">
            Configure repository analysis preferences, GitHub credentials, visual performance, and account details.
          </p>
        </div>

        <div className="settings-header-actions">
          <button
            type="button"
            className="settings-btn settings-btn-secondary"
            onClick={handleResetDefaults}
            title="Restore all settings to factory defaults"
          >
            <RotateCcw size={14} />
            <span>Reset to Defaults</span>
          </button>
        </div>
      </header>

      {/* Main Layout: Sidebar Navigation + Content Panes */}
      <div className="settings-layout">
        {/* Navigation Tabs */}
        <aside className="settings-nav" aria-label="Settings navigation">
          <button
            type="button"
            className={`settings-nav-item ${activeTab === 'github' ? 'active' : ''}`}
            onClick={() => setActiveTab('github')}
          >
            <Key size={16} className="settings-nav-icon" />
            <span>GitHub & API</span>
          </button>

          <button
            type="button"
            className={`settings-nav-item ${activeTab === 'analyzer' ? 'active' : ''}`}
            onClick={() => setActiveTab('analyzer')}
          >
            <Sliders size={16} className="settings-nav-icon" />
            <span>Codebase Analyzer</span>
          </button>

          <button
            type="button"
            className={`settings-nav-item ${activeTab === 'visualizer' ? 'active' : ''}`}
            onClick={() => setActiveTab('visualizer')}
          >
            <Code2 size={16} className="settings-nav-icon" />
            <span>Visualizer & Editor</span>
          </button>

          <button
            type="button"
            className={`settings-nav-item ${activeTab === 'account' ? 'active' : ''}`}
            onClick={() => setActiveTab('account')}
          >
            <User size={16} className="settings-nav-icon" />
            <span>Account & Profile</span>
          </button>

          <button
            type="button"
            className={`settings-nav-item ${activeTab === 'storage' ? 'active' : ''}`}
            onClick={() => setActiveTab('storage')}
          >
            <Database size={16} className="settings-nav-icon" />
            <span>Cache & Storage</span>
          </button>

          <button
            type="button"
            className={`settings-nav-item ${activeTab === 'system' ? 'active' : ''}`}
            onClick={() => setActiveTab('system')}
          >
            <Activity size={16} className="settings-nav-icon" />
            <span>System Health & About</span>
          </button>
        </aside>

        {/* Content Pane */}
        <main className="settings-content-pane">
          {/* TAB 1: GitHub & API Integration */}
          {activeTab === 'github' && (
            <div className="settings-card" id="section-github">
              <div className="settings-card-header">
                <div className="settings-card-title-group">
                  <h2 className="settings-card-title">
                    <Key size={18} color="#6898FF" />
                    <span>GitHub access</span>
                  </h2>
                  <p className="settings-card-subtitle">
                    Repositories are downloaded by the analysis server. Without a token GitHub allows 60 API requests per hour; with one, 5,000.
                  </p>
                </div>
              </div>

              <div className="settings-row-col">
                <div className="settings-label-group">
                  <label className="settings-label">Server token</label>
                  <span className="settings-description">
                    {sysInfo
                      ? sysInfo.githubTokenConfigured
                        ? 'The server has a GITHUB_TOKEN configured, so imports use the higher rate limit.'
                        : 'No token is configured. To raise the limit, add GITHUB_TOKEN (a GitHub personal access token, no scopes needed) to server/.env and restart the server. Tokens are never stored in the browser.'
                      : sysInfoError ?? 'Checking the server…'}
                  </span>
                </div>
              </div>

              <div className="settings-stat-badge-box">
                <div className="settings-stat-left">
                  <div className="settings-stat-icon-wrap">
                    <Activity size={20} />
                  </div>
                  <div className="settings-stat-details">
                    <div className="settings-stat-number">
                      {ghStatus ? `${ghStatus.remaining.toLocaleString()} / ${ghStatus.limit.toLocaleString()}` : 'Not checked yet'}
                    </div>
                    <div className="settings-stat-label">
                      {ghStatus
                        ? `Requests left for the server (${ghStatus.authenticated ? 'with token' : 'anonymous'}); resets at ${new Date(ghStatus.resetAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                        : 'Asks GitHub how many requests the server has left'}
                    </div>
                  </div>
                </div>
                <button type="button" className="settings-btn settings-btn-secondary" onClick={checkGitHub} disabled={ghLoading}>
                  <RefreshCw size={14} className={ghLoading ? 'spin' : ''} />
                  <span>{ghLoading ? 'Checking…' : 'Check rate limit'}</span>
                </button>
              </div>
            </div>
          )}

          {/* TAB 2: Codebase Analyzer & Parsing Rules */}
          {activeTab === 'analyzer' && (
            <div className="settings-card" id="section-analyzer">
              <div className="settings-card-header">
                <div className="settings-card-title-group">
                  <h2 className="settings-card-title">
                    <Sliders size={18} color="#FFD166" />
                    <span>Codebase analyzer</span>
                  </h2>
                  <p className="settings-card-subtitle">
                    Files and folders to leave out of your analyses, and the rules the server applies.
                  </p>
                </div>
              </div>

              <div className="settings-row-col">
                <div className="settings-label-group">
                  <label className="settings-label">Excluded files and folders</label>
                  <span className="settings-description">
                    Sent with every analysis you start from this browser (import or Re-analyze). A name like <code>docs</code> or <code>*.test.ts</code> matches anywhere; a path like <code>src/legacy</code> or <code>examples/**</code> matches from the repository root.
                  </span>
                </div>

                <div className="settings-tag-list">
                  {settings.excludedPatterns.length === 0 && <span className="settings-description">Nothing excluded.</span>}
                  {settings.excludedPatterns.map((pat) => (
                    <span key={pat} className="settings-tag-pill">
                      <span>{pat}</span>
                      <button type="button" className="settings-tag-remove-btn" onClick={() => settings.removeExcludedPattern(pat)} title={`Remove ${pat}`} aria-label={`Remove pattern ${pat}`}>
                        <X size={13} />
                      </button>
                    </span>
                  ))}
                </div>

                <form onSubmit={handleAddPattern} style={{ display: 'flex', gap: 10, maxWidth: 420 }}>
                  <input type="text" className="settings-input mono" placeholder="e.g. docs, *.test.ts, src/legacy" value={newPatternInput} onChange={(e) => { setNewPatternInput(e.target.value); setPatternError(null); }} aria-label="New excluded pattern" />
                  <button type="submit" className="settings-btn settings-btn-secondary">
                    <Plus size={14} />
                    <span>Add</span>
                  </button>
                </form>
                {patternError && <span className="settings-description" style={{ color: '#FF717A' }} role="alert">{patternError}</span>}
              </div>

              <div className="settings-row-col">
                <div className="settings-label-group">
                  <label className="settings-label">Always skipped by the server</label>
                  <span className="settings-description">
                    {sysInfo ? sysInfo.alwaysSkippedFolders.join(', ') : sysInfoError ?? 'Loading…'}
                  </span>
                </div>
              </div>

              {sysInfo && (
                <div className="settings-row-col">
                  <div className="settings-label-group">
                    <label className="settings-label">Limits and languages</label>
                    <span className="settings-description">
                      Up to {sysInfo.limits.maxFiles.toLocaleString()} files per analysis, within {Math.round(sysInfo.limits.analysisTimeBudgetMs / 1000)} seconds. Files over {(sysInfo.limits.maxParseBytes / 1e6).toFixed(1)} MB are not parsed. GitHub archives up to {Math.round(sysInfo.limits.maxGithubArchiveBytes / 1048576)} MB, ZIP uploads up to {Math.round(sysInfo.limits.maxZipUploadBytes / 1048576)} MB. Analyzer version {sysInfo.analyzerVersion}.
                    </span>
                  </div>
                  <div className="settings-tag-list">
                    {sysInfo.languages.map((l) => (
                      <span key={l.name} className="settings-tag-pill" title={`Functions: ${l.functions} · imports: ${l.dependencies}`}>
                        <span>{l.name}: {l.dependencies === 'full' ? 'full' : l.dependencies === 'none' && l.functions === 'none' ? 'counted only' : 'partial'}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: Visualizer & Code Explorer Preferences */}
          {activeTab === 'visualizer' && (
            <div className="settings-card" id="section-visualizer">
              <div className="settings-card-header">
                <div className="settings-card-title-group">
                  <h2 className="settings-card-title">
                    <Code2 size={18} color="#38BDF8" />
                    <span>Visualizer & Code Explorer Preferences</span>
                  </h2>
                  <p className="settings-card-subtitle">
                    Typography and line display for every code view (Code Explorer, Dependency Atlas, Onboarding Pathfinder).
                  </p>
                </div>
              </div>

              {/* Editor Font Size */}
              <div className="settings-row border-bottom">
                <div className="settings-label-group">
                  <label className="settings-label">Editor Font Size</label>
                  <span className="settings-description">
                    Adjust text size for source code inspection across all preview panels.
                  </span>
                </div>

                <div className="settings-segmented-group">
                  {[12, 14, 16].map((size) => (
                    <button
                      key={size}
                      type="button"
                      className={`settings-segmented-btn ${settings.editorFontSize === size ? 'active' : ''}`}
                      onClick={() => settings.setEditorFontSize(size)}
                    >
                      {size}px
                    </button>
                  ))}
                </div>
              </div>

              {/* Tab Spacing */}
              <div className="settings-row border-bottom">
                <div className="settings-label-group">
                  <label className="settings-label">Tab Spacing</label>
                  <span className="settings-description">
                    Number of spaces rendered for code indentation.
                  </span>
                </div>

                <div className="settings-segmented-group">
                  {[2, 4].map((spacing) => (
                    <button
                      key={spacing}
                      type="button"
                      className={`settings-segmented-btn ${settings.editorTabSpacing === spacing ? 'active' : ''}`}
                      onClick={() => settings.setEditorTabSpacing(spacing)}
                    >
                      {spacing} Spaces
                    </button>
                  ))}
                </div>
              </div>

              {/* Word Wrap */}
              <div className="settings-row border-bottom">
                <div className="settings-label-group">
                  <label className="settings-label">Word Wrap</label>
                  <span className="settings-description">
                    Wrap lines that exceed the editor viewport width instead of horizontal scrolling.
                  </span>
                </div>

                <label className="settings-toggle">
                  <input
                    type="checkbox"
                    checked={settings.editorWordWrap}
                    onChange={(e) => settings.setEditorWordWrap(e.target.checked)}
                  />
                  <span className="settings-toggle-track" />
                </label>
              </div>

              {/* Line Numbers */}
              <div className="settings-row border-bottom">
                <div className="settings-label-group">
                  <label className="settings-label">Line Numbers</label>
                  <span className="settings-description">
                    Show left-hand line numbering in the code viewer gutter.
                  </span>
                </div>

                <label className="settings-toggle">
                  <input
                    type="checkbox"
                    checked={settings.editorLineNumbers}
                    onChange={(e) => settings.setEditorLineNumbers(e.target.checked)}
                  />
                  <span className="settings-toggle-track" />
                </label>
              </div>

              {/* Live Preview Box */}
              <div className="settings-row-col">
                <div className="settings-label-group">
                  <label className="settings-label">Live Editor Preview</label>
                  <span className="settings-description">
                    Real-time preview of your current typography and indentation settings.
                  </span>
                </div>

                <div style={{ height: 160, width: '100%' }}>
                  <CodeViewer
                    code={sampleCode}
                    path="example.ts"
                    label="Live Settings Preview"
                  />
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: Account & Profile */}
          {activeTab === 'account' && (
            <div className="settings-card" id="section-account">
              <div className="settings-card-header">
                <div className="settings-card-title-group">
                  <h2 className="settings-card-title">
                    <User size={18} color="#C084FC" />
                    <span>Account & Session Details</span>
                  </h2>
                  <p className="settings-card-subtitle">
                    Manage your active Supabase authenticated credentials and workspace session.
                  </p>
                </div>
              </div>

              {/* Profile Card */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 18,
                  padding: '16px 20px',
                  background: 'rgba(12, 20, 42, 0.65)',
                  border: '1px solid rgba(135, 155, 255, 0.16)',
                  borderRadius: 14,
                }}
              >
                <div
                  style={{
                    width: 52,
                    height: 52,
                    borderRadius: '50%',
                    background: 'var(--gradient-primary)',
                    border: '2px solid rgba(184, 162, 255, 0.5)',
                    display: 'grid',
                    placeItems: 'center',
                    fontWeight: 700,
                    fontSize: 20,
                    color: '#FFF',
                    overflow: 'hidden',
                    flexShrink: 0,
                  }}
                >
                  {avatarUrl ? (
                    <img src={avatarUrl} alt={displayName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    initial
                  )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 16, fontWeight: 600, color: '#F3F6FF' }}>{displayName}</span>
                    <span
                      style={{
                        fontSize: 11,
                        color: '#43D9A3',
                        background: 'rgba(67, 217, 163, 0.15)',
                        border: '1px solid rgba(67, 217, 163, 0.3)',
                        borderRadius: 12,
                        padding: '1px 8px',
                        fontWeight: 600,
                      }}
                    >
                      Connected
                    </span>
                  </div>

                  <span style={{ fontSize: 13, color: 'var(--color-text-supporting)' }}>
                    {user?.email || 'Signed in via provider'}
                  </span>

                  <span style={{ fontSize: 11, color: '#77839C', fontFamily: 'var(--font-mono)' }}>
                    ID: {user?.id || 'Local Development User'}
                  </span>
                </div>

                <button
                  type="button"
                  className="settings-btn settings-btn-danger"
                  onClick={handleSignOut}
                >
                  <LogOut size={14} />
                  <span>Sign Out</span>
                </button>
              </div>

              {/* Session Information */}
              <div className="settings-row-col">
                <div className="settings-label-group">
                  <label className="settings-label">Security & Authentication</label>
                  <span className="settings-description">
                    Authentication is secured via Supabase JWT tokens with automatic session refresh.
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                  <div className="settings-stat-badge-box">
                    <div className="settings-stat-details">
                      <span className="settings-stat-label">Identity Provider</span>
                      <span className="settings-stat-number" style={{ fontSize: 13 }}>
                        {user?.app_metadata?.provider?.toUpperCase() || (user?.email ? 'EMAIL / PASSWORD' : 'SUPABASE OAUTH')}
                      </span>
                    </div>
                  </div>

                  <div className="settings-stat-badge-box">
                    <div className="settings-stat-details">
                      <span className="settings-stat-label">Session Status</span>
                      <span className="settings-stat-number" style={{ fontSize: 13, color: '#43D9A3' }}>
                        ACTIVE & VERIFIED
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 5: Cache & Storage Management */}
          {activeTab === 'storage' && (
            <div className="settings-card" id="section-storage">
              <div className="settings-card-header">
                <div className="settings-card-title-group">
                  <h2 className="settings-card-title">
                    <Database size={18} color="#FF717A" />
                    <span>Cache & Data Storage</span>
                  </h2>
                  <p className="settings-card-subtitle">
                    What this browser stores for The Astral Cartographer.
                  </p>
                </div>
              </div>

              {/* Storage Footprint */}
              <div className="settings-stat-badge-box">
                <div className="settings-stat-left">
                  <div className="settings-stat-icon-wrap" style={{ background: 'rgba(255, 113, 122, 0.15)', color: '#FF717A' }}>
                    <Database size={20} />
                  </div>
                  <div className="settings-stat-details">
                    <div className="settings-stat-number">{storageUsage.formatted}</div>
                    <div className="settings-stat-label">Approximate Local Storage Footprint across browser sessions</div>
                  </div>
                </div>

                <div style={{ textAlign: 'right', fontSize: 12, color: '#A7B4CC' }}>
                  <div>{repositories.length} repositories in your account</div>
                </div>
              </div>

              {/* Clear Local Cache Action */}
              <div className="settings-row border-bottom">
                <div className="settings-label-group">
                  <label className="settings-label">Flush Client-Side Cache</label>
                  <span className="settings-description">
                    Removes view preferences this browser remembers (such as panel sizes). Server data is not affected.
                  </span>
                </div>

                <button
                  type="button"
                  className="settings-btn settings-btn-secondary"
                  onClick={handleClearCache}
                >
                  <Trash2 size={14} color="#FFAD66" />
                  <span>Clear Local Cache</span>
                </button>
              </div>

              {/* Factory Reset */}
              <div className="settings-row">
                <div className="settings-label-group">
                  <label className="settings-label">Factory Reset Preferences</label>
                  <span className="settings-description">
                    Remove your excluded patterns and restore the default editor preferences.
                  </span>
                </div>

                <button
                  type="button"
                  className="settings-btn settings-btn-danger"
                  onClick={handleResetDefaults}
                >
                  <RotateCcw size={14} />
                  <span>Reset All to Defaults</span>
                </button>
              </div>
            </div>
          )}

          {/* TAB 6: System Health & About */}
          {activeTab === 'system' && (
            <div className="settings-card" id="section-system">
              <div className="settings-card-header">
                <div className="settings-card-title-group">
                  <h2 className="settings-card-title">
                    <Activity size={18} color="#43D9A3" />
                    <span>System Health & Connectivity</span>
                  </h2>
                  <p className="settings-card-subtitle">
                    Live operational telemetry and component status for connected services.
                  </p>
                </div>

                <button
                  type="button"
                  className="settings-btn settings-btn-secondary"
                  onClick={checkHealth}
                  style={{ fontSize: 11.5 }}
                >
                  <RefreshCw
                    size={13}
                    className={systemHealth.backend === 'checking' ? 'spin' : ''}
                    style={{ animation: systemHealth.backend === 'checking' ? 'spin 1s linear infinite' : 'none' }}
                  />
                  <span>Refresh Health</span>
                </button>
              </div>

              {/* Live Health Indicators Grid */}
              <div className="settings-health-grid">
                {/* Node 1: Analysis Backend */}
                <div className="settings-health-node">
                  <div className="settings-health-top">
                    <span className="settings-health-name">Analysis Backend API</span>
                    <span className={`settings-health-pill ${systemHealth.backend}`}>
                      {systemHealth.backend === 'checking'
                        ? 'Checking...'
                        : systemHealth.backend === 'ok'
                        ? 'Operational'
                        : 'Offline'}
                    </span>
                  </div>
                  <div className="settings-health-desc">
                    Node.js & Express analysis service.
                    {systemHealth.backendLatency ? ` Latency: ${systemHealth.backendLatency}ms` : ''}
                  </div>
                </div>

                {/* Node 2: Database (MongoDB) */}
                <div className="settings-health-node">
                  <div className="settings-health-top">
                    <span className="settings-health-name">Repository Database</span>
                    <span
                      className={`settings-health-pill ${
                        systemHealth.database === 'connected' || systemHealth.database === 'memory' ? 'ok' : 'error'
                      }`}
                    >
                      {systemHealth.database === 'checking'
                        ? 'Checking...'
                        : systemHealth.database === 'connected'
                        ? 'Connected'
                        : systemHealth.database === 'memory'
                        ? 'Memory Mode'
                        : 'Disconnected'}
                    </span>
                  </div>
                  <div className="settings-health-desc">
                    {systemHealth.databaseMode === 'in-memory'
                      ? 'In-memory MongoDB instance active for rapid development.'
                      : 'Persistent MongoDB cluster active for repository records.'}
                  </div>
                </div>

                {/* Node 3: Supabase Auth */}
                <div className="settings-health-node">
                  <div className="settings-health-top">
                    <span className="settings-health-name">Supabase Cloud Auth</span>
                    <span
                      className={`settings-health-pill ${
                        systemHealth.supabase === 'connected' ? 'ok' : 'degraded'
                      }`}
                    >
                      {systemHealth.supabase === 'connected' ? 'Connected' : 'Not Configured'}
                    </span>
                  </div>
                  <div className="settings-health-desc">
                    {systemHealth.supabase === 'connected'
                      ? 'OAuth, secure session cookies, and JWT verification enabled.'
                      : 'Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in client/.env to enable.'}
                  </div>
                </div>
              </div>

              {/* About & Engine Specs */}
              <div
                style={{
                  marginTop: 12,
                  padding: '16px 20px',
                  background: 'rgba(7, 12, 27, 0.65)',
                  border: '1px solid rgba(135, 155, 255, 0.14)',
                  borderRadius: 14,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: 16,
                }}
              >
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#F3F6FF' }}>
                    The Astral Cartographer
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-supporting)', marginTop: 2 }}>
                    {sysInfo ? `Analyzer ${sysInfo.analyzerVersion} · ` : ''}Built with React, TypeScript, Express, MongoDB and the Babel parser
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 10 }}>
                  <a
                    href="https://github.com/abhigya-dev-creator/The-Astral-Cartographer"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="settings-btn settings-btn-secondary"
                    style={{ fontSize: 11.5 }}
                  >
                    <ExternalLink size={13} />
                    <span>Documentation</span>
                  </a>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Floating Feedback Toast */}
      {toastMessage && (
        <div className={`settings-toast ${toastMessage.type}`} role="status">
          {toastMessage.type === 'success' ? (
            <Check size={16} color="#43D9A3" />
          ) : (
            <AlertCircle size={16} color="#FF717A" />
          )}
          <span>{toastMessage.text}</span>
        </div>
      )}

      {/* Confirmation Modal */}
      {confirmModal && confirmModal.isOpen && (
        <div className="settings-modal-backdrop" onClick={() => setConfirmModal(null)}>
          <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="settings-modal-title">{confirmModal.title}</h3>
            <p className="settings-modal-body">{confirmModal.body}</p>
            <div className="settings-modal-footer">
              <button
                type="button"
                className="settings-btn settings-btn-secondary"
                onClick={() => setConfirmModal(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="settings-btn settings-btn-danger"
                onClick={confirmModal.action}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
