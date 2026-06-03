import { create } from "zustand";

type WorkspaceState = {
  currentChapterId: string | null;
  setCurrentChapterId: (id: string | null) => void;
};

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  currentChapterId: null,
  setCurrentChapterId: (id) => set({ currentChapterId: id })
}));
