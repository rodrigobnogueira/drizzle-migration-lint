export { runBaseline, type BaselineResult } from './baseline';
export {
  CONFIG_BASENAME,
  loadConfig,
  resolveLocation,
  type DmlConfig,
  type SeverityOverride,
} from './config';
export { compareFindings, computeNewTables, lint, type LintOptions } from './engine';
export { UsageError } from './errors';
export { loadPgParser, type PgParseFn } from './pg/ast';
export { EXIT_CLEAN, EXIT_FINDINGS, EXIT_USAGE, computeExitCode } from './exit-code';
export type { FailOn } from './exit-code';
export { detectFormat, readMigrationSet } from './formats';
export { REPORTERS, defaultReporter, isReporterName } from './reporters';
export { resolveScope, type ScopeOptions } from './scope';
export { RULES } from './rules';
export { normalizeDialect } from './snapshot';
export { STATEMENT_BREAKPOINT, splitStatements } from './splitter';
export { applySuppressions, parseDirectives } from './suppressions';
export type * from './types';
