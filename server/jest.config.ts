import type { Config } from 'jest'

// ESM mode: `ai` and `@ai-sdk/*` are ESM-only packages (D20).
const config: Config = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  extensionsToTreatAsEsm: ['.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { useESM: true }] },
  moduleNameMapper: {
    // Tests run against shared's source, so no build is needed first.
    '^@spam-checker/shared$': '<rootDir>/../shared/src/index.ts',
    // NodeNext imports end in `.js`; point them back at the `.ts` source.
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
}

export default config
