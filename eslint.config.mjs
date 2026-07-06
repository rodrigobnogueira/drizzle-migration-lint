import tsParser from '@typescript-eslint/parser';
import sonarjs from 'eslint-plugin-sonarjs';

export default [
  {
    ignores: ['dist/**', 'coverage/**', '**/*.d.ts', 'test/fixtures/**'],
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
      ...sonarjs.configs.recommended.rules,
      // enforced separately at threshold 15 by eslint.complexity-check.config.mjs
      'sonarjs/cognitive-complexity': 'off',
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    plugins: {
      sonarjs,
    },
    rules: {
      ...sonarjs.configs.recommended.rules,
      'sonarjs/cognitive-complexity': 'off',
      // dev-only tooling (never shipped — see package.json "files"): it shells
      // out to npm/drizzle-kit in controlled dev/CI environments by design
      'sonarjs/no-os-command-from-path': 'off',
      'sonarjs/os-command': 'off',
    },
  },
];
