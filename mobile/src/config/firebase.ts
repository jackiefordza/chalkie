import { initializeApp, getApps, getApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions';

const useEmulator = process.env.EXPO_PUBLIC_USE_FIREBASE_EMULATOR === 'true';

export const firebaseConfig = {
  apiKey: 'AIzaSyBKC5qrnJ6HGGOR0F5qf-CbYHcmvvmnqAA',
  authDomain: 'chalkie-app.firebaseapp.com',
  // A "demo-" project id tells the Firebase Local Emulator Suite this is a
  // fully offline/local project — it then skips every call to real Google
  // Cloud endpoints (Admin SDK config, billing checks, etc.), which otherwise
  // fail hard in a network-restricted sandbox with no real GCP credentials.
  projectId: useEmulator ? 'demo-chalkie' : 'chalkie-app',
  storageBucket: 'chalkie-app.firebasestorage.app',
  messagingSenderId: '947789418402',
  appId: '1:947789418402:web:e3cc81d9fe166cd865ecfb',
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

export const auth = getAuth(app);
export const db = getFirestore(app);
export const functions = getFunctions(app);

// Local dev/testing only — points at the Firebase Local Emulator Suite
// instead of the real chalkie-app project, so features can be exercised
// against fake seeded data with no risk to real league data. Off by default;
// production builds never set this env var, so this block is a no-op there.
if (useEmulator) {
  const host = process.env.EXPO_PUBLIC_FIREBASE_EMULATOR_HOST ?? 'localhost';
  connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
  connectFirestoreEmulator(db, host, 8080);
  connectFunctionsEmulator(functions, host, 5001);
}
