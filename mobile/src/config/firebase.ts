import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';
import { resolveFirebaseConfig } from '@/lib/firebaseEnv';

// Resolution logic (which project, which required env vars, the
// no-silent-fallback guarantee) lives in lib/firebaseEnv.ts, split out
// specifically so it's unit-testable without the initializeApp side effect
// below. See mobile/.env.staging.example for where staging's values come
// from, and firebaseEnv.test.ts for what's actually verified.
//
// Each process.env.EXPO_PUBLIC_* access below MUST stay written out
// literally at its own call site, not behind a variable or passed-through
// object — Expo's babel-preset-expo inlines EXPO_PUBLIC_* values at build
// time by statically matching exactly this `process.env.EXPO_PUBLIC_X`
// member-expression pattern in the source. Passing the whole `process.env`
// object into a function (as an earlier version of this file did) defeats
// that: the inlining never fires, so every one of these reads back as
// undefined in a real build, and isStaging/buildStagingConfig's "throw if
// missing" path fires for every single staging build regardless of what
// was actually provided — verified by inspecting the compiled bundle, not
// just reasoned about.
const resolved = resolveFirebaseConfig({
  EXPO_PUBLIC_FIREBASE_ENV: process.env.EXPO_PUBLIC_FIREBASE_ENV,
  EXPO_PUBLIC_FIREBASE_STAGING_API_KEY: process.env.EXPO_PUBLIC_FIREBASE_STAGING_API_KEY,
  EXPO_PUBLIC_FIREBASE_STAGING_APP_ID: process.env.EXPO_PUBLIC_FIREBASE_STAGING_APP_ID,
  EXPO_PUBLIC_FIREBASE_STAGING_PROJECT_ID: process.env.EXPO_PUBLIC_FIREBASE_STAGING_PROJECT_ID,
  EXPO_PUBLIC_FIREBASE_STAGING_AUTH_DOMAIN: process.env.EXPO_PUBLIC_FIREBASE_STAGING_AUTH_DOMAIN,
  EXPO_PUBLIC_FIREBASE_STAGING_STORAGE_BUCKET: process.env.EXPO_PUBLIC_FIREBASE_STAGING_STORAGE_BUCKET,
  EXPO_PUBLIC_FIREBASE_STAGING_MESSAGING_SENDER_ID: process.env.EXPO_PUBLIC_FIREBASE_STAGING_MESSAGING_SENDER_ID,
});

export const isStaging = resolved.isStaging;
export const firebaseConfig = resolved.config;

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

export const auth = getAuth(app);
export const db = getFirestore(app);
export const functions = getFunctions(app);
