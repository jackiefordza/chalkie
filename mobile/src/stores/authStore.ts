import { create } from 'zustand';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import {
  doc,
  setDoc,
  updateDoc,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore';
import { auth, db } from '@/config/firebase';
import type { AppUser, PhoneVisibility } from '@/types';

interface AuthState {
  firebaseUser: User | null;
  appUser: AppUser | null;
  isLoading: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  updateContactDetails: (phone: string, phoneVisibility: PhoneVisibility) => Promise<void>;
  updateProfileDetails: (name: string, nickname: string | null) => Promise<void>;
  logOut: () => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  firebaseUser: null,
  appUser: null,
  isLoading: true,
  error: null,

  signIn: async (email, password) => {
    set({ error: null });
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (e: unknown) {
      set({ error: friendlyAuthError(e) });
      throw e;
    }
  },

  register: async (email, password, displayName) => {
    set({ error: null });
    try {
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(credential.user, { displayName });
      await setDoc(doc(db, 'users', credential.user.uid), {
        email,
        displayName,
        role: 'pending',
        leagueId: null,
        teamId: null,
        divisionId: null,
        playerId: null,
        isLeagueAdmin: false,
        isGlobalAdmin: false,
        pendingRequestType: null,
        createdAt: serverTimestamp(),
      });
      // Set appUser immediately — onAuthStateChanged fires before setDoc completes
      useAuthStore.setState({
        firebaseUser: credential.user,
        appUser: {
          uid: credential.user.uid,
          email,
          displayName,
          nickname: null,
          role: 'pending',
          isLeagueAdmin: false,
          isGlobalAdmin: false,
          leagueId: null,
          seasonId: null,
          teamId: null,
          divisionId: null,
          playerId: null,
          pendingRequestType: null,
          pendingRequestId: null,
          phone: null,
          phoneVisibility: null,
          createdAt: new Date(),
        },
        isLoading: false,
      });
    } catch (e: unknown) {
      set({ error: friendlyAuthError(e) });
      throw e;
    }
  },

  updateContactDetails: async (phone: string, phoneVisibility: PhoneVisibility) => {
    const currentUser = auth.currentUser;
    if (!currentUser) throw new Error('Not authenticated');
    await updateDoc(doc(db, 'users', currentUser.uid), { phone, phoneVisibility });
  },

  updateProfileDetails: async (name: string, nickname: string | null) => {
    const currentUser = auth.currentUser;
    if (!currentUser) throw new Error('Not authenticated');
    await updateProfile(currentUser, { displayName: name });
    await updateDoc(doc(db, 'users', currentUser.uid), { displayName: name, nickname });
  },

  logOut: async () => {
    await signOut(auth);
    set({ firebaseUser: null, appUser: null });
  },

  clearError: () => set({ error: null }),
}));

function friendlyAuthError(e: unknown): string {
  const code = (e as { code?: string }).code ?? '';
  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found')
    return 'Invalid email or password.';
  if (code === 'auth/email-already-in-use') return 'An account with this email already exists.';
  if (code === 'auth/weak-password') return 'Password must be at least 6 characters.';
  if (code === 'auth/invalid-email') return 'Please enter a valid email address.';
  if (code === 'auth/network-request-failed') return 'No internet connection.';
  if (code === 'auth/too-many-requests') return 'Too many attempts. Please try again later.';
  return (e as Error).message ?? 'Something went wrong.';
}

export function initAuthListener() {
  let userUnsub: (() => void) | null = null;

  const authUnsub = onAuthStateChanged(auth, (user) => {
    if (userUnsub) { userUnsub(); userUnsub = null; }

    if (!user) {
      useAuthStore.setState({ firebaseUser: null, appUser: null, isLoading: false });
      return;
    }

    useAuthStore.setState({ firebaseUser: user, isLoading: true });

    // Real-time listener — role changes by admin/captain propagate instantly
    userUnsub = onSnapshot(
      doc(db, 'users', user.uid),
      (snap) => {
        if (snap.exists()) {
          const d = snap.data();
          useAuthStore.setState({
            appUser: {
              uid: user.uid,
              email: d.email ?? user.email ?? '',
              displayName: d.displayName ?? user.displayName ?? '',
              nickname: d.nickname ?? null,
              role: d.role,
              isLeagueAdmin: d.isLeagueAdmin ?? false,
              isGlobalAdmin: d.isGlobalAdmin ?? false,
              leagueId: d.leagueId ?? null,
              seasonId: d.seasonId ?? null,
              teamId: d.teamId ?? null,
              divisionId: d.divisionId ?? null,
              playerId: d.playerId ?? null,
              pendingRequestType: d.pendingRequestType ?? null,
              pendingRequestId: d.pendingRequestId ?? null,
              phone: d.phone ?? null,
              phoneVisibility: d.phoneVisibility ?? null,
              createdAt: d.createdAt?.toDate() ?? new Date(),
            },
            isLoading: false,
          });
        } else {
          useAuthStore.setState({ isLoading: false });
        }
      },
      () => useAuthStore.setState({ isLoading: false }),
    );
  });

  return () => {
    if (userUnsub) userUnsub();
    authUnsub();
  };
}
