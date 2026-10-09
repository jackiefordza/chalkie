import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isStagingEnv, resolveStagingConfig, resolveFirebaseConfig, PRODUCTION_CONFIG } from './firebaseEnv';

const STAGING_ENV_COMPLETE = {
  EXPO_PUBLIC_FIREBASE_ENV: 'staging',
  EXPO_PUBLIC_FIREBASE_STAGING_API_KEY: 'test-api-key',
  EXPO_PUBLIC_FIREBASE_STAGING_APP_ID: 'test-app-id',
};

test('isStagingEnv: only the exact string "staging" activates staging mode', () => {
  assert.equal(isStagingEnv({ EXPO_PUBLIC_FIREBASE_ENV: 'staging' }), true);
  assert.equal(isStagingEnv({}), false);
  assert.equal(isStagingEnv({ EXPO_PUBLIC_FIREBASE_ENV: undefined }), false);
  assert.equal(isStagingEnv({ EXPO_PUBLIC_FIREBASE_ENV: 'production' }), false);
  assert.equal(isStagingEnv({ EXPO_PUBLIC_FIREBASE_ENV: 'Staging' }), false);
  assert.equal(isStagingEnv({ EXPO_PUBLIC_FIREBASE_ENV: '' }), false);
});

test('resolveFirebaseConfig: no EXPO_PUBLIC_FIREBASE_ENV set at all resolves to production, unconditionally', () => {
  const { isStaging, config } = resolveFirebaseConfig({});
  assert.equal(isStaging, false);
  assert.deepEqual(config, PRODUCTION_CONFIG);
  assert.equal(config.projectId, 'chalkie-app');
});

test('resolveFirebaseConfig: a typo or unrecognized value for EXPO_PUBLIC_FIREBASE_ENV still resolves to production, not staging', () => {
  for (const value of ['prod', 'Staging', 'STAGING', ' staging', 'staging ', 'true']) {
    const { isStaging, config } = resolveFirebaseConfig({ EXPO_PUBLIC_FIREBASE_ENV: value });
    assert.equal(isStaging, false, `expected "${value}" to resolve to production`);
    assert.equal(config.projectId, 'chalkie-app');
  }
});

test('resolveStagingConfig: throws when EXPO_PUBLIC_FIREBASE_STAGING_API_KEY is missing — never falls back silently', () => {
  assert.throws(
    () => resolveStagingConfig({ ...STAGING_ENV_COMPLETE, EXPO_PUBLIC_FIREBASE_STAGING_API_KEY: undefined }),
    /EXPO_PUBLIC_FIREBASE_STAGING_API_KEY/,
  );
});

test('resolveStagingConfig: throws when EXPO_PUBLIC_FIREBASE_STAGING_APP_ID is missing — never falls back silently', () => {
  assert.throws(
    () => resolveStagingConfig({ ...STAGING_ENV_COMPLETE, EXPO_PUBLIC_FIREBASE_STAGING_APP_ID: undefined }),
    /EXPO_PUBLIC_FIREBASE_STAGING_APP_ID/,
  );
});

test('resolveStagingConfig: throws on an empty string, not just a missing key', () => {
  assert.throws(() => resolveStagingConfig({ ...STAGING_ENV_COMPLETE, EXPO_PUBLIC_FIREBASE_STAGING_API_KEY: '' }));
});

test('resolveStagingConfig: with only the two required values set, defaults projectId/authDomain by convention', () => {
  const config = resolveStagingConfig(STAGING_ENV_COMPLETE);
  assert.equal(config.apiKey, 'test-api-key');
  assert.equal(config.appId, 'test-app-id');
  assert.equal(config.projectId, 'chalkie-app-staging');
  assert.equal(config.authDomain, 'chalkie-app-staging.firebaseapp.com');
  assert.equal(config.storageBucket, undefined);
  assert.equal(config.messagingSenderId, undefined);
});

test('resolveStagingConfig: explicit overrides win over the derived defaults', () => {
  const config = resolveStagingConfig({
    ...STAGING_ENV_COMPLETE,
    EXPO_PUBLIC_FIREBASE_STAGING_PROJECT_ID: 'chalkie-app-staging-abc123',
    EXPO_PUBLIC_FIREBASE_STAGING_AUTH_DOMAIN: 'custom.example.com',
  });
  assert.equal(config.projectId, 'chalkie-app-staging-abc123');
  assert.equal(config.authDomain, 'custom.example.com');
});

test('resolveStagingConfig: optional storageBucket/messagingSenderId pass through when provided', () => {
  const config = resolveStagingConfig({
    ...STAGING_ENV_COMPLETE,
    EXPO_PUBLIC_FIREBASE_STAGING_STORAGE_BUCKET: 'chalkie-app-staging.firebasestorage.app',
    EXPO_PUBLIC_FIREBASE_STAGING_MESSAGING_SENDER_ID: '123456789',
  });
  assert.equal(config.storageBucket, 'chalkie-app-staging.firebasestorage.app');
  assert.equal(config.messagingSenderId, '123456789');
});

test('resolveFirebaseConfig: a complete staging env never collides with production — projectId always differs', () => {
  const { isStaging, config } = resolveFirebaseConfig(STAGING_ENV_COMPLETE);
  assert.equal(isStaging, true);
  assert.notEqual(config.projectId, PRODUCTION_CONFIG.projectId);
  assert.notEqual(config.apiKey, PRODUCTION_CONFIG.apiKey);
});

test('PRODUCTION_CONFIG is exactly the config that was hardcoded before staging support existed', () => {
  assert.deepEqual(PRODUCTION_CONFIG, {
    apiKey: 'AIzaSyBKC5qrnJ6HGGOR0F5qf-CbYHcmvvmnqAA',
    authDomain: 'chalkie-app.firebaseapp.com',
    projectId: 'chalkie-app',
    storageBucket: 'chalkie-app.firebasestorage.app',
    messagingSenderId: '947789418402',
    appId: '1:947789418402:web:e3cc81d9fe166cd865ecfb',
  });
});
