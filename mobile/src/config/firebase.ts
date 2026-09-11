import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore, getFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';

export const firebaseConfig = {
  apiKey: 'AIzaSyBKC5qrnJ6HGGOR0F5qf-CbYHcmvvmnqAA',
  authDomain: 'chalkie-app.firebaseapp.com',
  projectId: 'chalkie-app',
  storageBucket: 'chalkie-app.firebasestorage.app',
  messagingSenderId: '947789418402',
  appId: '1:947789418402:web:e3cc81d9fe166cd865ecfb',
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

export const auth = getAuth(app);

// MW-004: a persistent (IndexedDB-backed) local cache lets reads fall back
// to last-known data instead of erroring outright during a genuine network
// drop, and lets a queued offline write survive a refresh/tab close instead
// of being silently lost — real risk for a phone on real pub wifi. Live
// listeners still sync from the server exactly as before whenever
// connectivity is present; nothing about online read/write behaviour
// changes. persistentMultipleTabManager avoids the single-tab manager's
// silent no-persistence fallback if a user happens to have Chalkie open in
// two tabs. Falls back to the previous plain in-memory cache if persistence
// can't be established (e.g. a locked-down browser without IndexedDB)
// rather than failing to start.
function createFirestore() {
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch {
    return getFirestore(app);
  }
}

export const db = createFirestore();
export const functions = getFunctions(app);
