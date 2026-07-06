import tsParser from '@typescript-eslint/parser';
import sonarjs from 'eslint-plugin-sonarjs';

// Report config: threshold 0 surfaces EVERY function's cognitive complexity so
// the collector can emit a full per-function summary. The failing gate lives in
// eslint.complexity-check.config.mjs (threshold 15).
export default [
  {
    ignores: ['dist/**', 'coverage/**', '**/*.d.ts', '**/*.js', 'test/**'],
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    plugins: {
      sonarjs,
    },
    rules: {
      'sonarjs/cognitive-complexity': ['warn', 0],
    },
  },
];
