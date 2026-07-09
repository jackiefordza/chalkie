import { create } from 'zustand';

interface UiState {
  isAccountMenuOpen: boolean;
  openAccountMenu: () => void;
  closeAccountMenu: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  isAccountMenuOpen: false,
  openAccountMenu: () => set({ isAccountMenuOpen: true }),
  closeAccountMenu: () => set({ isAccountMenuOpen: false }),
}));
