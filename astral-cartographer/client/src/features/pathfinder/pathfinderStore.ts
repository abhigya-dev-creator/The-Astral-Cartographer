import { create } from 'zustand';
import { pathfinderApi, type PathfinderState } from './pathfinderApi';
import type { ChatMessage } from './companionAnswers';
import type { Effort, OppType } from './opportunities';

export type Mode = 'beginner' | 'contributor';
export type BeginnerTab = 'overview' | 'connections' | 'code' | 'next';
export type ContributorTab = 'overview' | 'files' | 'how';
export interface OppFilters { type: OppType | 'all'; effort: Effort | 'all'; area: string; savedOnly: boolean }
/** 'local' = progress is shown but not stored (no server); 'error' = the last save failed */
export type SyncState = 'idle' | 'loading' | 'saving' | 'saved' | 'local' | 'error';

interface PathfinderStore {
  repositoryId: string | null;
  mode: Mode;
  /** Beginner Path: the file shown in the centre panel (a queue step, or another file opened from search or links) */
  beginnerPath: string | null;
  beginnerTab: BeginnerTab;
  codeLine: { line: number; nonce: number } | null;
  /** Contributor Path */
  oppId: string | null;
  contributorTab: ContributorTab;
  filters: OppFilters;
  /** progress */
  completed: ReadonlySet<string>;
  current: string | null;
  saved: ReadonlySet<string>;
  sync: SyncState;
  syncMessage: string | null;
  /** companion conversations, one per mode, kept when switching modes */
  chats: Record<Mode, ChatMessage[]>;

  reset: (repositoryId: string | null) => void;
  loadProgress: () => Promise<void>;
  setMode: (m: Mode) => void;
  openFile: (path: string, opts?: { line?: number; tab?: BeginnerTab }) => void;
  setBeginnerTab: (t: BeginnerTab) => void;
  setComplete: (path: string, done: boolean) => void;
  selectOpp: (id: string | null) => void;
  setContributorTab: (t: ContributorTab) => void;
  setFilters: (f: Partial<OppFilters>) => void;
  toggleSaved: (id: string) => void;
  pushChat: (mode: Mode, ...msgs: Omit<ChatMessage, 'id'>[]) => void;
}

const DEFAULT_FILTERS: OppFilters = { type: 'all', effort: 'all', area: 'all', savedOnly: false };
let msgId = 0;
let saveTimer = 0;
let pending: Partial<PathfinderState> = {};

export const usePathfinderStore = create<PathfinderStore>((set, get) => {
  /** Merge a change into the next save; current-step changes are debounced, others go out at once. */
  const persist = (patch: Partial<PathfinderState>, debounce = false) => {
    const repo = get().repositoryId;
    if (!repo || get().sync === 'local') return;
    pending = { ...pending, ...patch };
    clearTimeout(saveTimer);
    const flush = async () => {
      const body = pending;
      pending = {};
      set({ sync: 'saving' });
      try {
        await pathfinderApi.save(repo, body);
        if (get().repositoryId === repo) set({ sync: 'saved', syncMessage: null });
      } catch (err) {
        if (get().repositoryId === repo) set({ sync: 'error', syncMessage: err instanceof Error ? err.message : 'Progress could not be saved.' });
      }
    };
    if (debounce) saveTimer = window.setTimeout(flush, 800);
    else void flush();
  };

  return {
    repositoryId: null,
    mode: 'beginner',
    beginnerPath: null,
    beginnerTab: 'overview',
    codeLine: null,
    oppId: null,
    contributorTab: 'overview',
    filters: DEFAULT_FILTERS,
    completed: new Set(),
    current: null,
    saved: new Set(),
    sync: 'idle',
    syncMessage: null,
    chats: { beginner: [], contributor: [] },

    reset: (repositoryId) => {
      clearTimeout(saveTimer);
      pending = {};
      set({
        repositoryId, beginnerPath: null, beginnerTab: 'overview', codeLine: null, oppId: null, contributorTab: 'overview',
        filters: DEFAULT_FILTERS, completed: new Set(), current: null, saved: new Set(), sync: repositoryId ? 'idle' : 'local', syncMessage: null,
        chats: { beginner: [], contributor: [] },
      });
    },

    loadProgress: async () => {
      const repo = get().repositoryId;
      if (!repo) return;
      set({ sync: 'loading' });
      try {
        const s = await pathfinderApi.load(repo);
        if (get().repositoryId !== repo) return;
        set({ completed: new Set(s.completed), current: s.current, saved: new Set(s.saved), sync: 'saved', syncMessage: null });
      } catch (err) {
        if (get().repositoryId !== repo) return;
        set({ sync: 'local', syncMessage: `${err instanceof Error ? err.message : 'Saved progress could not be loaded.'} Progress on this page is not saved.` });
      }
    },

    setMode: (mode) => set({ mode }),

    openFile: (path, opts = {}) => {
      set((s) => ({
        beginnerPath: path,
        beginnerTab: opts.tab ?? (s.beginnerPath === path ? s.beginnerTab : 'overview'),
        codeLine: opts.line ? { line: opts.line, nonce: Date.now() } : null,
        current: path,
      }));
      persist({ current: path }, true);
    },

    setBeginnerTab: (beginnerTab) => set({ beginnerTab }),

    setComplete: (path, done) => {
      const completed = new Set(get().completed);
      if (done) completed.add(path); else completed.delete(path);
      set({ completed });
      persist({ completed: [...completed] });
    },

    selectOpp: (oppId) => set((s) => ({ oppId, contributorTab: s.oppId === oppId ? s.contributorTab : 'overview' })),
    setContributorTab: (contributorTab) => set({ contributorTab }),
    setFilters: (f) => set((s) => ({ filters: { ...s.filters, ...f } })),

    toggleSaved: (id) => {
      const saved = new Set(get().saved);
      if (saved.has(id)) saved.delete(id); else saved.add(id);
      set({ saved });
      persist({ saved: [...saved] });
    },

    pushChat: (mode, ...msgs) => set((s) => ({ chats: { ...s.chats, [mode]: [...s.chats[mode], ...msgs.map((m) => ({ ...m, id: ++msgId }))] } })),
  };
});
