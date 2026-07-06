// Mutation testing — LOCAL ONLY, on demand. Deliberately not wired into CI.
//
//   npm run test:mutation                     incremental (the pre-PR ritual)
//   STRYKER_MUTATE='src/rules/**'             scope to the files you changed
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  mutate: process.env.STRYKER_MUTATE
    ? process.env.STRYKER_MUTATE.split(',')
    : ['src/**/*.ts', '!src/types.ts'],
  testRunner: 'command',
  // `test:mutant` = the normal suite plus `--test-force-exit`: a mutant that
  // breaks teardown would otherwise leave open handles and turn every kill
  // into a slow timeout.
  commandRunner: {
    command: 'npm run test:mutant',
  },
  // Each command-runner mutant already runs test files in parallel (node
  // --test child processes); higher Stryker concurrency oversubscribes the
  // CPU and turns every kill into a timeout.
  concurrency: 4,
  timeoutMS: 15000,
  incremental: true,
  ignorePatterns: ['coverage', 'dist', 'docs', 'test/fixtures'],
  reporters: ['clear-text', 'progress', 'html'],
  thresholds: { high: 90, low: 80, break: null },
  tempDirName: '.stryker-tmp',
};
