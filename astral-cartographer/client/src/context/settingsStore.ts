import { create } from 'zustand';

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset: number;
  used?: number;
  checkedAt: number;
}

export interface SettingsState {
  // 1. GitHub & API
  githubToken: string;
  rateLimitStatus: RateLimitInfo | null;
  isCheckingRateLimit: boolean;

  // 2. Codebase Analyzer & Parsing Rules
  ignoredPatterns: string[];
  maxFileSizeKB: number;
  supportedLanguages: {
    javascript: boolean;
    typescript: boolean;
    java: boolean;
    python: boolean;
  };
  astDepthLimit: number;

  // 3. Visualizer & Code Explorer Preferences
  editorFontSize: number;
  editorTabSpacing: number;
  editorWordWrap: boolean;
  editorLineNumbers: boolean;
  atlasViewMode: '2d' | '3d';
  atlasPhysicsEnabled: boolean;

  // Actions
  setGithubToken: (token: string) => void;
  setRateLimitStatus: (status: RateLimitInfo | null) => void;
  checkGitHubRateLimit: () => Promise<RateLimitInfo | null>;
  addIgnoredPattern: (pattern: string) => void;
  removeIgnoredPattern: (pattern: string) => void;
  resetIgnoredPatterns: () => void;
  setMaxFileSizeKB: (size: number) => void;
  setSupportedLanguage: (lang: keyof SettingsState['supportedLanguages'], enabled: boolean) => void;
  setAstDepthLimit: (depth: number) => void;
  setEditorFontSize: (size: number) => void;
  setEditorTabSpacing: (spacing: number) => void;
  setEditorWordWrap: (wrap: boolean) => void;
  setEditorLineNumbers: (show: boolean) => void;
  setAtlasViewMode: (mode: '2d' | '3d') => void;
  setAtlasPhysicsEnabled: (enabled: boolean) => void;
  resetToDefaults: () => void;
}

const STORAGE_KEY = 'astral_cartographer_settings_v1';

const DEFAULT_IGNORED_PATTERNS = [
  'node_modules',
  'dist',
  'build',
  '.git',
  'coverage',
  '.next',
  '.turbo',
  'vendor',
];

const DEFAULT_SETTINGS = {
  githubToken: '',
  rateLimitStatus: null,
  isCheckingRateLimit: false,
  ignoredPatterns: DEFAULT_IGNORED_PATTERNS,
  maxFileSizeKB: 500,
  supportedLanguages: {
    javascript: true,
    typescript: true,
    java: true,
    python: true,
  },
  astDepthLimit: 8,
  editorFontSize: 12,
  editorTabSpacing: 2,
  editorWordWrap: false,
  editorLineNumbers: true,
  atlasViewMode: '2d' as const,
  atlasPhysicsEnabled: true,
};

function loadStoredSettings(): Partial<typeof DEFAULT_SETTINGS> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function persistSettings(state: SettingsState) {
  try {
    const dataToSave = {
      githubToken: state.githubToken,
      rateLimitStatus: state.rateLimitStatus,
      ignoredPatterns: state.ignoredPatterns,
      maxFileSizeKB: state.maxFileSizeKB,
      supportedLanguages: state.supportedLanguages,
      astDepthLimit: state.astDepthLimit,
      editorFontSize: state.editorFontSize,
      editorTabSpacing: state.editorTabSpacing,
      editorWordWrap: state.editorWordWrap,
      editorLineNumbers: state.editorLineNumbers,
      atlasViewMode: state.atlasViewMode,
      atlasPhysicsEnabled: state.atlasPhysicsEnabled,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(dataToSave));
  } catch (err) {
    console.warn('Failed to save settings to localStorage:', err);
  }
}

const initial = {
  ...DEFAULT_SETTINGS,
  ...loadStoredSettings(),
};

export const useSettings = create<SettingsState>((set, get) => ({
  ...initial,

  setGithubToken: (token) => {
    set({ githubToken: token.trim() });
    persistSettings(get());
  },

  setRateLimitStatus: (status) => {
    set({ rateLimitStatus: status });
    persistSettings(get());
  },

  checkGitHubRateLimit: async () => {
    set({ isCheckingRateLimit: true });
    try {
      const token = get().githubToken.trim();
      const headers: Record<string, string> = {
        Accept: 'application/vnd.github+json',
      };
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const res = await fetch('https://api.github.com/rate_limit', { headers });
      if (!res.ok) {
        throw new Error(`GitHub responded with HTTP ${res.status}`);
      }

      const data = await res.json();
      const core = data?.resources?.core || data?.rate;
      if (!core) throw new Error('Invalid rate limit response format');

      const info: RateLimitInfo = {
        limit: core.limit,
        remaining: core.remaining,
        reset: core.reset,
        used: core.used ?? core.limit - core.remaining,
        checkedAt: Date.now(),
      };

      set({ rateLimitStatus: info, isCheckingRateLimit: false });
      persistSettings(get());
      return info;
    } catch (err) {
      set({ isCheckingRateLimit: false });
      throw err;
    }
  },

  addIgnoredPattern: (pattern) => {
    const p = pattern.trim();
    if (!p) return;
    const current = get().ignoredPatterns;
    if (current.includes(p)) return;
    set({ ignoredPatterns: [...current, p] });
    persistSettings(get());
  },

  removeIgnoredPattern: (pattern) => {
    set({
      ignoredPatterns: get().ignoredPatterns.filter((item) => item !== pattern),
    });
    persistSettings(get());
  },

  resetIgnoredPatterns: () => {
    set({ ignoredPatterns: DEFAULT_IGNORED_PATTERNS });
    persistSettings(get());
  },

  setMaxFileSizeKB: (size) => {
    set({ maxFileSizeKB: Math.max(50, Math.min(5120, size)) });
    persistSettings(get());
  },

  setSupportedLanguage: (lang, enabled) => {
    set((state) => ({
      supportedLanguages: {
        ...state.supportedLanguages,
        [lang]: enabled,
      },
    }));
    persistSettings(get());
  },

  setAstDepthLimit: (depth) => {
    set({ astDepthLimit: Math.max(1, Math.min(20, depth)) });
    persistSettings(get());
  },

  setEditorFontSize: (size) => {
    set({ editorFontSize: size });
    persistSettings(get());
  },

  setEditorTabSpacing: (spacing) => {
    set({ editorTabSpacing: spacing });
    persistSettings(get());
  },

  setEditorWordWrap: (wrap) => {
    set({ editorWordWrap: wrap });
    persistSettings(get());
  },

  setEditorLineNumbers: (show) => {
    set({ editorLineNumbers: show });
    persistSettings(get());
  },

  setAtlasViewMode: (mode) => {
    set({ atlasViewMode: mode });
    persistSettings(get());
  },

  setAtlasPhysicsEnabled: (enabled) => {
    set({ atlasPhysicsEnabled: enabled });
    persistSettings(get());
  },

  resetToDefaults: () => {
    set({
      ...DEFAULT_SETTINGS,
      githubToken: '',
      rateLimitStatus: null,
    });
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
  },
}));
