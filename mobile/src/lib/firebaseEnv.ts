// Pure, side-effect-free Firebase config resolution — split out from
// config/firebase.ts (which calls initializeApp as a side effect at import
// time) so the actual safety property here — a staging build can never
// silently fall back to production, or vice versa — is directly
// unit-testable rather than just asserted in a comment. See
// mobile/.env.staging.example for where the staging values come from.

export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  storageBucket?: string;
  messagingSenderId?: string;
}

type Env = Record<string, string | undefined>;

// Production — chalkie-app. The only config that existed before staging
// support was added; unconditional, no env-var dependency at all.
export const PRODUCTION_CONFIG: FirebaseWebConfig = {
  apiKey: 'AIzaSyBKC5qrnJ6HGGOR0F5qf-CbYHcmvvmnqAA',
  authDomain: 'chalkie-app.firebaseapp.com',
  projectId: 'chalkie-app',
  storageBucket: 'chalkie-app.firebasestorage.app',
  messagingSenderId: '947789418402',
  appId: '1:947789418402:web:e3cc81d9fe166cd865ecfb',
};

export function isStagingEnv(env: Env): boolean {
  return env.EXPO_PUBLIC_FIREBASE_ENV === 'staging';
}

function requireStagingValue(env: Env, name: string): string {
  const value = env[name];
  if (!value) {
    throw new Error(
      `isStaging is true but ${name} is not set. Staging builds need every required `
      + 'EXPO_PUBLIC_FIREBASE_STAGING_* env var — see mobile/.env.staging.example.',
    );
  }
  return value;
}

// Deliberately no fallback for apiKey/appId (Firebase-generated, unique per
// project, can't be derived or safely guessed) — throws rather than
// returning an incomplete config, so a staging build missing either one
// fails loudly at startup instead of silently running with a broken or
// (worse) wrong config.
export function resolveStagingConfig(env: Env): FirebaseWebConfig {
  // Not secret (a public project identifier) and already confirmed — kept
  // as a literal default so only the two unguessable values above are
  // strictly required, but still overridable in case the console shows a
  // different exact ID (e.g. an auto-suffixed one).
  const projectId = env.EXPO_PUBLIC_FIREBASE_STAGING_PROJECT_ID || 'chalkie-app-staging';
  return {
    apiKey: requireStagingValue(env, 'EXPO_PUBLIC_FIREBASE_STAGING_API_KEY'),
    appId: requireStagingValue(env, 'EXPO_PUBLIC_FIREBASE_STAGING_APP_ID'),
    projectId,
    // Firebase's standard convention, matching how production's own
    // authDomain is literally `${projectId}.firebaseapp.com` — not a guess
    // at a project-specific value, just that fixed naming rule.
    authDomain: env.EXPO_PUBLIC_FIREBASE_STAGING_AUTH_DOMAIN || `${projectId}.firebaseapp.com`,
    // This app never imports firebase/storage or firebase/messaging, so
    // neither field has any effect on behavior — included only if
    // provided, never required.
    storageBucket: env.EXPO_PUBLIC_FIREBASE_STAGING_STORAGE_BUCKET || undefined,
    messagingSenderId: env.EXPO_PUBLIC_FIREBASE_STAGING_MESSAGING_SENDER_ID || undefined,
  };
}

export function resolveFirebaseConfig(env: Env): { isStaging: boolean; config: FirebaseWebConfig } {
  const staging = isStagingEnv(env);
  return { isStaging: staging, config: staging ? resolveStagingConfig(env) : PRODUCTION_CONFIG };
}
