/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  // Integration tests need the emulator suite running (npm run test:integration)
  // and share the .test.ts suffix, so exclude them explicitly here.
  testPathIgnorePatterns: ['/node_modules/', '\\.integration\\.test\\.ts$'],
};
