import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface LeagueSummary { id: string; name: string }
interface TeamSummary { id: string; name: string }

interface OnboardingState {
  league: LeagueSummary | null;
  team: TeamSummary | null;       // pre-set when arriving via tc invite code
  skipChoosePath: boolean;        // true when arriving via lc or tc code
  captainPath: boolean | null;    // true = captain, false = player, null = not chosen
  hasHydrated: boolean;           // true once persisted state has loaded from disk
  setLeague: (league: LeagueSummary) => void;
  setTeam: (team: TeamSummary | null) => void;
  setSkipChoosePath: (v: boolean) => void;
  setCaptainPath: (v: boolean) => void;
  setHasHydrated: (v: boolean) => void;
  clear: () => void;
}

// Persisted (not just in-memory) so a reload or the OS relaunching the app
// mid-onboarding doesn't strand the user on browse-teams/request-captain-role
// with no league to fetch against and no way back — see ONBOARD-1.
export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set) => ({
      league: null,
      team: null,
      skipChoosePath: false,
      captainPath: null,
      hasHydrated: false,
      setLeague: (league) => set({ league }),
      setTeam: (team) => set({ team }),
      setSkipChoosePath: (v) => set({ skipChoosePath: v }),
      setCaptainPath: (v) => set({ captainPath: v }),
      setHasHydrated: (v) => set({ hasHydrated: v }),
      clear: () => set({ league: null, team: null, skipChoosePath: false, captainPath: null }),
    }),
    {
      name: 'chalkie:onboarding',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        league: state.league,
        team: state.team,
        skipChoosePath: state.skipChoosePath,
        captainPath: state.captainPath,
      }),
      onRehydrateStorage: () => (state) => { state?.setHasHydrated(true); },
    },
  ),
);
