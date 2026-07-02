import { create } from 'zustand';

interface LeagueSummary { id: string; name: string }
interface TeamSummary { id: string; name: string }

interface OnboardingState {
  league: LeagueSummary | null;
  team: TeamSummary | null;       // pre-set when arriving via tc invite code
  skipChoosePath: boolean;        // true when arriving via lc or tc code
  captainPath: boolean | null;    // true = captain, false = player, null = not chosen
  setLeague: (league: LeagueSummary) => void;
  setTeam: (team: TeamSummary | null) => void;
  setSkipChoosePath: (v: boolean) => void;
  setCaptainPath: (v: boolean) => void;
  clear: () => void;
}

export const useOnboardingStore = create<OnboardingState>((set) => ({
  league: null,
  team: null,
  skipChoosePath: false,
  captainPath: null,
  setLeague: (league) => set({ league }),
  setTeam: (team) => set({ team }),
  setSkipChoosePath: (v) => set({ skipChoosePath: v }),
  setCaptainPath: (v) => set({ captainPath: v }),
  clear: () => set({ league: null, team: null, skipChoosePath: false, captainPath: null }),
}));
