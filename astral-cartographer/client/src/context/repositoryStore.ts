import { create } from 'zustand';
import { RepositoryDetails, RepositorySummary } from '../lib/api';

interface RepositoryState {
  repositories: RepositorySummary[];
  selectedRepo: RepositorySummary | null;
  /** Full data (complete analysis + history) for the selected repository */
  details: RepositoryDetails | null;
  searchQuery: string;
  isLoading: boolean;
  setRepositories: (repos: RepositorySummary[]) => void;
  setSelectedRepo: (repo: RepositorySummary | null) => void;
  setDetails: (details: RepositoryDetails | null) => void;
  setSearchQuery: (query: string) => void;
  setIsLoading: (loading: boolean) => void;
}

export const useRepositoryStore = create<RepositoryState>((set) => ({
  repositories: [],
  selectedRepo: null,
  details: null,
  searchQuery: '',
  isLoading: false,
  setRepositories: (repos) => {
    set((state) => {
      // If currently selected repo exists in new list, update it; otherwise pick first if none selected
      const currentId = state.selectedRepo?._id;
      const updatedSelected = currentId
        ? repos.find((r) => r._id === currentId) || repos[0] || null
        : repos[0] || null;

      return { repositories: repos, selectedRepo: updatedSelected };
    });
  },
  setSelectedRepo: (repo) =>
    set((state) => ({
      selectedRepo: repo,
      // Drop details that belong to a different repository
      details: repo && state.details?.repository._id === repo._id ? state.details : null,
    })),
  setDetails: (details) => set({ details }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setIsLoading: (loading) => set({ isLoading: loading }),
}));
