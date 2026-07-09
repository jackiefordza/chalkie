import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface AdminContextState {
  seasonId: string | null;
  divisionId: string | null;
  setContext: (seasonId: string, divisionId: string) => void;
  clear: () => void;
}

// Persisted so an admin's last-chosen season/division survives a reload —
// without this, every "Teams"/"Fixtures"/"Results"/"Standings" shortcut had
// to guess which season to jump into (picking whichever was marked active),
// which broke the moment more than one season existed (e.g. a real season
// alongside test/mock seed data) with no way to point it at the other one.
export const useAdminContextStore = create<AdminContextState>()(
  persist(
    (set) => ({
      seasonId: null,
      divisionId: null,
      setContext: (seasonId, divisionId) => set({ seasonId, divisionId }),
      clear: () => set({ seasonId: null, divisionId: null }),
    }),
    {
      name: 'chalkie:admin-context',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
