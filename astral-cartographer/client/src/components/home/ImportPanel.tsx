import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, Folder, Layers, Link as LinkIcon, Network, Shield, Sparkles, UploadCloud } from 'lucide-react';
import { AnalysisStage } from '../../lib/api';
import { MAX_ZIP_BYTES, parseGitHubUrl } from '../../lib/analysisFormat';
import { GithubIcon, Notice, Spinner, StageProgress } from './ui';

export interface AnalysisProgress {
  label: string;
  stage: AnalysisStage | null;
  message: string | null;
}

export interface ImportNotice {
  tone: 'red' | 'green' | 'blue';
  title: string;
  detail?: string;
}

/** Lets the page pre-fill the panel, e.g. "Re-upload ZIP" for a ZIP repository. */
export interface ImportPrefill {
  tab: 'github' | 'zip';
  value: string;
  force: boolean;
  nonce: number;
}

interface ImportPanelProps {
  progress: AnalysisProgress | null;
  notice: ImportNotice | null;
  prefill: ImportPrefill | null;
  onDismissNotice: () => void;
  onAnalyzeGitHub: (url: string, force: boolean) => Promise<boolean>;
  onAnalyzeZip: (file: File, projectName: string, force: boolean) => Promise<boolean>;
}

function tabStyle(active: boolean): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 16px',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.16s ease',
    background: active ? 'linear-gradient(135deg, rgba(30, 80, 240, 0.5) 0%, rgba(56, 107, 255, 0.25) 100%)' : 'transparent',
    border: active ? '1px solid rgba(100, 160, 255, 0.6)' : '1px solid transparent',
    color: active ? '#FFFFFF' : '#94A3B8',
    boxShadow: active ? '0 0 16px rgba(56, 107, 255, 0.25)' : 'none',
  };
}

function validateZip(file: File): string | null {
  if (!file.name.toLowerCase().endsWith('.zip')) return 'Only .zip files are supported.';
  if (file.size > MAX_ZIP_BYTES) {
    return `"${file.name}" is ${(file.size / (1024 * 1024)).toFixed(1)} MB. The maximum upload size is 50 MB.`;
  }
  if (file.size === 0) return `"${file.name}" is empty.`;
  return null;
}

export default function ImportPanel({
  progress,
  notice,
  prefill,
  onDismissNotice,
  onAnalyzeGitHub,
  onAnalyzeZip,
}: ImportPanelProps) {
  const [activeTab, setActiveTab] = useState<'github' | 'zip'>('github');
  const [githubUrl, setGithubUrl] = useState('');
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [projectName, setProjectName] = useState('');
  const [force, setForce] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);
  const isAnalyzing = progress !== null;

  useEffect(() => {
    if (!prefill) return;
    setActiveTab(prefill.tab);
    setForce(prefill.force);
    setFormError(null);
    if (prefill.tab === 'github') {
      setGithubUrl(prefill.value);
      urlInputRef.current?.focus();
    } else {
      setProjectName(prefill.value);
    }
  }, [prefill]);

  const switchTab = (tab: 'github' | 'zip') => {
    setActiveTab(tab);
    setFormError(null);
  };

  const selectZip = (file: File) => {
    const problem = validateZip(file);
    if (problem) {
      setFormError(problem);
      return;
    }
    setFormError(null);
    setZipFile(file);
    if (!projectName) {
      setProjectName(file.name.replace(/\.zip$/i, ''));
    }
  };

  const handleSubmitGitHub = async (e: React.FormEvent) => {
    e.preventDefault();
    onDismissNotice();
    const trimmed = githubUrl.trim();
    if (!trimmed) {
      setFormError('Please enter a GitHub repository URL.');
      return;
    }
    if (!parseGitHubUrl(trimmed)) {
      setFormError('Invalid URL. Expected https://github.com/owner/repository (optionally /tree/<branch>).');
      return;
    }
    setFormError(null);
    if (await onAnalyzeGitHub(trimmed, force)) {
      setGithubUrl('');
      setForce(false);
    }
  };

  const handleSubmitZip = async (e: React.FormEvent) => {
    e.preventDefault();
    onDismissNotice();
    if (!zipFile) {
      setFormError('Please select a .zip repository file to upload.');
      return;
    }
    const problem = validateZip(zipFile);
    if (problem) {
      setFormError(problem);
      return;
    }
    setFormError(null);
    if (await onAnalyzeZip(zipFile, projectName.trim(), force)) {
      setZipFile(null);
      setProjectName('');
      setForce(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const forceToggle = (
    <label className="auth-checkbox-label" style={{ fontSize: 11, color: '#A7B4CC' }}>
      <input
        type="checkbox"
        className="auth-checkbox"
        checked={force}
        disabled={isAnalyzing}
        onChange={(e) => setForce(e.target.checked)}
      />
      Force re-analysis
      <span style={{ color: '#77839C' }}>(ignore a previous result for the same commit/archive)</span>
    </label>
  );

  return (
    <div
      id="import-panel"
      className="card"
      style={{
        marginBottom: 32,
        padding: '22px clamp(16px, 3vw, 26px)',
        borderRadius: 16,
        background: 'rgba(7, 12, 27, 0.72)',
        border: '1px solid rgba(135, 155, 255, 0.22)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        boxShadow: '0 16px 40px rgba(0, 0, 0, 0.35)',
      }}
    >
      {/* Tab Headers */}
      <div role="tablist" aria-label="Import source" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 18 }}>
        <button type="button" role="tab" aria-selected={activeTab === 'github'} onClick={() => switchTab('github')} style={tabStyle(activeTab === 'github')}>
          <GithubIcon />
          GitHub Repository
        </button>
        <button type="button" role="tab" aria-selected={activeTab === 'zip'} onClick={() => switchTab('zip')} style={tabStyle(activeTab === 'zip')}>
          <Folder size={16} />
          Upload ZIP
        </button>
      </div>

      {/* Tab 1: GitHub Repository Input */}
      {activeTab === 'github' && (
        <form onSubmit={handleSubmitGitHub} noValidate style={{ marginBottom: 16 }}>
          <div className="import-url-row">
            <LinkIcon size={16} color="#77839C" style={{ flexShrink: 0 }} />
            <input
              ref={urlInputRef}
              type="url"
              inputMode="url"
              disabled={isAnalyzing}
              value={githubUrl}
              onChange={(e) => {
                setGithubUrl(e.target.value);
                if (formError) setFormError(null);
              }}
              placeholder="Paste GitHub repository URL (e.g. https://github.com/user/repo)"
              aria-label="GitHub repository URL"
              aria-invalid={Boolean(formError)}
              style={{
                flex: 1,
                minWidth: 0,
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: '#EAF0FF',
                fontSize: 13,
                fontFamily: 'Inter, sans-serif',
              }}
            />
            <button
              type="submit"
              disabled={isAnalyzing}
              className="btn-primary"
              style={{ height: 42, padding: '0 20px', borderRadius: 9, fontSize: 13, gap: 8, flexShrink: 0 }}
            >
              {isAnalyzing ? (
                <>
                  <Spinner />
                  Analyzing...
                </>
              ) : (
                <>
                  Analyze <ArrowRight size={14} />
                </>
              )}
            </button>
          </div>
          <div style={{ marginTop: 10 }}>{forceToggle}</div>
        </form>
      )}

      {/* Tab 2: Upload ZIP */}
      {activeTab === 'zip' && (
        <form onSubmit={handleSubmitZip} noValidate style={{ marginBottom: 16 }}>
          <div
            role="button"
            tabIndex={0}
            aria-label="Choose a .zip file to upload"
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              if (!isAnalyzing && e.dataTransfer.files?.[0]) selectZip(e.dataTransfer.files[0]);
            }}
            onClick={() => !isAnalyzing && fileInputRef.current?.click()}
            onKeyDown={(e) => {
              if ((e.key === 'Enter' || e.key === ' ') && !isAnalyzing) {
                e.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            style={{
              border: `1px dashed ${isDragging ? 'rgba(135, 155, 255, 0.7)' : 'rgba(135, 155, 255, 0.35)'}`,
              borderRadius: 12,
              padding: '24px 20px',
              textAlign: 'center',
              background: isDragging ? 'rgba(56, 107, 255, 0.1)' : 'rgba(4, 8, 19, 0.5)',
              cursor: isAnalyzing ? 'not-allowed' : 'pointer',
              marginBottom: 14,
              transition: 'all 0.16s ease',
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip,application/zip"
              style={{ display: 'none' }}
              onChange={(e) => {
                if (e.target.files?.[0]) selectZip(e.target.files[0]);
              }}
            />
            <UploadCloud size={28} color="#8B78FF" style={{ margin: '0 auto 8px' }} />
            <div style={{ fontSize: 13, color: '#EAF0FF', fontWeight: 500, marginBottom: 4, overflowWrap: 'anywhere' }}>
              {zipFile
                ? `Selected: ${zipFile.name} (${(zipFile.size / (1024 * 1024)).toFixed(1)} MB)`
                : 'Drag and drop your repository .zip file here, or click to browse'}
            </div>
            <div style={{ fontSize: 11, color: '#77839C' }}>
              Supports standard .zip project archives (up to 50 MB). Extracted securely server-side.
            </div>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: '1 1 260px', minWidth: 0 }}>
              <input
                type="text"
                className="auth-input"
                value={projectName}
                disabled={isAnalyzing}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="Project name (optional)"
                aria-label="Project name"
                style={{ padding: '9px 12px', fontSize: 13, maxWidth: 360 }}
              />
              {forceToggle}
            </div>
            <button
              type="submit"
              disabled={isAnalyzing || !zipFile}
              className="btn-primary"
              style={{ height: 40, padding: '0 20px', borderRadius: 8, fontSize: 13, gap: 8, opacity: zipFile ? 1 : 0.55 }}
            >
              {isAnalyzing ? (
                <>
                  <Spinner />
                  Analyzing ZIP...
                </>
              ) : (
                <>
                  Upload & Analyze <ArrowRight size={14} />
                </>
              )}
            </button>
          </div>
        </form>
      )}

      {/* Real progress from GET /api/repositories/:id/status */}
      {progress && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: '#EAF0FF', fontWeight: 500, marginBottom: 6, overflowWrap: 'anywhere' }}>
            Analyzing {progress.label}
          </div>
          <StageProgress stage={progress.stage} message={progress.message} />
        </div>
      )}

      {formError && <Notice tone="red" title={formError} onClose={() => setFormError(null)} style={{ marginBottom: 16 }} />}

      {notice && (
        <Notice tone={notice.tone} title={notice.title} onClose={onDismissNotice} style={{ marginBottom: 16 }}>
          {notice.detail}
        </Notice>
      )}

      {/* Capability Badges */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 20px', fontSize: 11, color: '#8B9BB4' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Shield size={13} color="#6898FF" />
          <span>Supports public repositories</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Sparkles size={13} color="#8B78FF" />
          <span>Automatic code analysis</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Network size={13} color="#37D9FF" />
          <span>Interactive visualizations</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Layers size={13} color="#FFAD66" />
          <span>Detailed architectural insights</span>
        </div>
      </div>
    </div>
  );
}
