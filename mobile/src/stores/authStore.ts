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
  getDoc,
  updateDoc,
  runTransaction,
  collection,
  onSnapshot,
  serverTimestamp,
  writeBatch,
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
  processJoinCode: (code: string, phone?: string, phoneVisibility?: PhoneVisibility) => Promise<void>;
  processClaimCode: (code: string) => Promise<void>;
  updateContactDetails: (phone: string, phoneVisibility: PhoneVisibility) => Promise<void>;
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
          role: 'pending',
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

  processJoinCode: async (code: string, phone?: string, phoneVisibility?: PhoneVisibility) => {
    const currentUser = auth.currentUser;
    if (!currentUser) throw new Error('Not authenticated');

    const trimmed = code.trim().toUpperCase();
    const uid = currentUser.uid;
    const displayName = currentUser.displayName ?? currentUser.email ?? 'Unknown';
    const playerRef = doc(collection(db, 'players'));

    await runTransaction(db, async (txn) => {
      const codeRef = doc(db, 'joinCodes', trimmed);
      const codeDoc = await txn.get(codeRef);
      if (!codeDoc.exists()) throw new Error('Invalid join code');
      const data = codeDoc.data();
      if (data.usedByUserId != null) throw new Error('Code already used');

      const { role, leagueId, teamId, seasonId, divisionId } = data as Record<string, string>;

      txn.update(codeRef, { usedByUserId: uid, usedAt: serverTimestamp() });
      txn.set(playerRef, {
        leagueId, seasonId, divisionId, teamId,
        name: displayName,
        claimedByUserId: uid,
        claimedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
      });
      txn.update(doc(db, 'users', uid), {
        role, leagueId, teamId, divisionId,
        playerId: playerRef.id,
        joinedViaCode: trimmed,
        ...(phone ? { phone, phoneVisibility: phoneVisibility ?? 'captains' } : {}),
      });
      const teamField = role === 'viceCaptain' ? 'viceCaptainUserId' : 'captainUserId';
      txn.update(doc(db, 'teams', teamId), { [teamField]: uid });
    });
  },

  updateContactDetails: async (phone: string, phoneVisibility: PhoneVisibility) => {
    const currentUser = auth.currentUser;
    if (!currentUser) throw new Error('Not authenticated');
    await updateDoc(doc(db, 'users', currentUser.uid), { phone, phoneVisibility });
  },

  processClaimCode: async (code: string) => {
    const currentUser = auth.currentUser;
    if (!currentUser) throw new Error('Not authenticated');

    const uid = currentUser.uid;
    const trimmed = code.trim().toUpperCase();
    const codeRef = doc(db, 'claimCodes', trimmed);
    const codeSnap = await getDoc(codeRef);

    if (!codeSnap.exists()) throw new Error('Invalid claim code');
    const codeData = codeSnap.data();
    if (codeData.usedByUserId != null) throw new Error('This code has already been used');

    const { playerId, leagueId, teamId } = codeData as Record<string, string>;

    await runTransaction(db, async (txn) => {
      txn.update(codeRef, { usedByUserId: uid, usedAt: serverTimestamp() });
      txn.update(doc(db, 'players', playerId), {
        claimedByUserId: uid,
        claimedAt: serverTimestamp(),
      });
      txn.update(doc(db, 'users', uid), {
        role: 'player',
        leagueId,
        teamId,
        playerId,
        pendingRequestType: null,
      });
    });
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
              role: d.role,
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
