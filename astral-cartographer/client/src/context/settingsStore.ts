import { create } from 'zustand';

/**
 * Settings that really change something, saved in this browser:
 *  - excludedPatterns: sent with every analysis you start (Home import, Re-analyze); the server skips matching files.
 *  - editor preferences: used by every code view (CodeViewer).
 * Server-side facts (limits, skipped folders, GitHub rate limit) are not settings; Settings reads them from the server.
 */
export interface SettingsState {
  excludedPatterns: string[];
  editorFontSize: number;
  editorTabSpacing: number;
  editorWordWrap: boolean;
  editorLineNumbers: boolean;

  addExcludedPattern: (pattern: string) => void;
  removeExcludedPattern: (pattern: string) => void;
  clearExcludedPatterns: () => void;
  setEditorFontSize: (size: number) => void;
  setEditorTabSpacing: (spacing: number) => void;
  setEditorWordWrap: (wrap: boolean) => void;
  setEditorLineNumbers: (show: boolean) => void;
  resetToDefaults: () => void;
}

const STORAGE_KEY = 'astral_cartographer_settings_v2';
/** earlier version: also held a GitHub token in plain text and options the analyzer never used */
const LEGACY_KEY = 'astral_cartographer_settings_v1';
/** v1 pre-filled folders the server always skips anyway; they are not user exclusions */
const LEGACY_DEFAULT_PATTERNS = new Set(['node_modules', 'dist', 'build', '.git', 'coverage', '.next', '.turbo', 'vendor']);

export const EXCLUDE_PATTERN_LIMITS = { MAX_PATTERNS: 50, MAX_LENGTH: 200 };
const PATTERN_RE = /^[A-Za-z0-9._\-/*?@+ ]+$/;

type Stored = Pick<SettingsState, 'excludedPatterns' | 'editorFontSize' | 'editorTabSpacing' | 'editorWordWrap' | 'editorLineNumbers'>;

const DEFAULTS: Stored = {
  excludedPatterns: [],
  editorFontSize: 12,
  editorTabSpacing: 2,
  editorWordWrap: false,
  editorLineNumbers: true,
};

/** Why a pattern cannot be used (same rules as the server), or null when it is fine. */
export function excludePatternProblem(raw: string): string | null {
  const p = raw.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!p) return 'Enter a file or folder name, or a path.';
  if (p.length > EXCLUDE_PATTERN_LIMITS.MAX_LENGTH) return `Patterns can be at most ${EXCLUDE_PATTERN_LIMITS.MAX_LENGTH} characters.`;
  if (!PATTERN_RE.test(p)) return 'Use letters, numbers, . _ - / and the wildcards * and ?.';
  if (p.startsWith('/') || p.split('/').includes('..')) return 'Use names or paths inside the repository (no leading "/" or "..").';
  return null;
}

function clean(s: Partial<Stored>): Stored {
  const num = (v: unknown, allowed: number[], d: number) => (typeof v === 'number' && allowed.includes(v) ? v : d);
  return {
    excludedPatterns: Array.isArray(s.excludedPatterns)
      ? [...new Set(s.excludedPatterns.filter((p): p is string => typeof p === 'string' && !excludePatternProblem(p)).map((p) => p.trim()))].slice(0, EXCLUDE_PATTERN_LIMITS.MAX_PATTERNS)
      : [],
    editorFontSize: num(s.editorFontSize, [12, 14, 16], DEFAULTS.editorFontSize),
    editorTabSpacing: num(s.editorTabSpacing, [2, 4], DEFAULTS.editorTabSpacing),
    editorWordWrap: typeof s.editorWordWrap === 'boolean' ? s.editorWordWrap : DEFAULTS.editorWordWrap,
    editorLineNumbers: typeof s.editorLineNumbers === 'boolean' ? s.editorLineNumbers : DEFAULTS.editorLineNumbers,
  };
}

function load(): Stored {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return clean(JSON.parse(raw));
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      // keep the editor preferences and any patterns the user added; drop everything else (including a stored token)
      const old = JSON.parse(legacy) ?? {};
      localStorage.removeItem(LEGACY_KEY);
      const migrated = clean({ ...old, excludedPatterns: (old.ignoredPatterns ?? []).filter((p: string) => !LEGACY_DEFAULT_PATTERNS.has(p)) });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      return migrated;
    }
  } catch {
    /* storage unavailable or corrupt: defaults */
  }
  return { ...DEFAULTS };
}

function save(s: Stored) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(clean(s)));
  } catch {
    /* storage unavailable: the settings still apply for this visit */
  }
}

export const useSettings = create<SettingsState>((set, get) => {
  const update = (patch: Partial<Stored>) => {
    set(patch);
    save(get());
  };
  return {
    ...load(),
    addExcludedPattern: (pattern) => {
      const p = pattern.trim().replace(/\\/g, '/').replace(/^\.\//, '');
      if (excludePatternProblem(p) || get().excludedPatterns.includes(p) || get().excludedPatterns.length >= EXCLUDE_PATTERN_LIMITS.MAX_PATTERNS) return;
      update({ excludedPatterns: [...get().excludedPatterns, p] });
    },
    removeExcludedPattern: (pattern) => update({ excludedPatterns: get().excludedPatterns.filter((p) => p !== pattern) }),
    clearExcludedPatterns: () => update({ excludedPatterns: [] }),
    setEditorFontSize: (editorFontSize) => update({ editorFontSize }),
    setEditorTabSpacing: (editorTabSpacing) => update({ editorTabSpacing }),
    setEditorWordWrap: (editorWordWrap) => update({ editorWordWrap }),
    setEditorLineNumbers: (editorLineNumbers) => update({ editorLineNumbers }),
    resetToDefaults: () => update({ ...DEFAULTS }),
  };
});
