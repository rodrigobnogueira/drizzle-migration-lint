#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { runBaseline } from './baseline';
import { loadConfig, resolveLocation, type DmlConfig } from './config';
import { lint } from './engine';
import { UsageError } from './errors';
import { explainRule } from './explain';
import { EXIT_CLEAN, EXIT_USAGE, computeExitCode, type FailOn } from './exit-code';
import { readMigrationSet } from './formats';
import { REPORTERS, defaultReporter, isReporterName, type ReporterName } from './reporters';
import { resolveScope } from './scope';
import { normalizeDialect } from './snapshot';
import type { Dialect, MigrationSet } from './types';

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  cwd: string;
  env: NodeJS.ProcessEnv;
}

const USAGE = `drizzle-migration-lint — catch drizzle-kit migrations that will lock or rewrite your production tables

Usage:
  drizzle-migration-lint [check] [options]
  drizzle-migration-lint baseline [options]
  drizzle-migration-lint explain <rule-id>

Commands:
  check              lint migrations (default)
  baseline           record the latest migration as reviewed, so later runs lint only newer ones
  explain <rule-id>  print the rationale and safe alternative for a rule

Options:
  --dir <path>       migrations directory (default: config/drizzle.config out, else ./drizzle)
  --dialect <name>   only needed when the artifacts don't say (postgresql|mysql|sqlite|turso|...)
  --since <git-ref>  lint only migrations added since a git ref (PR/CI mode)
  --all              lint the entire history, ignoring any configured baseline
  --config <path>    path to .drizzle-migration-lint.json
  --format <name>    pretty | json | github | sarif (default: github under $GITHUB_ACTIONS, else pretty)
  --fail-on <level>  error | warn | none (default: error)
  -h, --help         show this help
  -v, --version      print the version

Exit codes: 0 clean (or below --fail-on), 1 findings, 2 usage/environment error.`;

interface ParsedCli {
  command: 'check' | 'baseline' | 'explain';
  /** the rule id for `explain`, else undefined */
  rule: string | undefined;
  dir: string | undefined;
  dialect: Dialect | undefined;
  since: string | undefined;
  all: boolean;
  config: string | undefined;
  format: ReporterName | undefined;
  failOn: FailOn;
  help: boolean;
  version: boolean;
}

function parseFormat(value: string | undefined): ReporterName | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isReporterName(value)) {
    throw new UsageError(`unknown --format "${value}" (expected: pretty | json | github | sarif)`);
  }
  return value;
}

function parseFailOn(value: string): FailOn {
  if (value !== 'error' && value !== 'warn' && value !== 'none') {
    throw new UsageError(`unknown --fail-on "${value}" (expected: error | warn | none)`);
  }
  return value;
}

function parseDialect(value: string | undefined): Dialect | undefined {
  if (value === undefined) {
    return undefined;
  }
  const dialect = normalizeDialect(value);
  if (!dialect) {
    throw new UsageError(`unknown --dialect "${value}"`);
  }
  return dialect;
}

function parseCliArgs(argv: string[]): ParsedCli {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        dir: { type: 'string' },
        dialect: { type: 'string' },
        since: { type: 'string' },
        all: { type: 'boolean' },
        config: { type: 'string' },
        format: { type: 'string' },
        'fail-on': { type: 'string', default: 'error' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
    });
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
  const { values, positionals } = parsed;
  const command = positionals[0] ?? 'check';
  if (command === 'explain') {
    if (positionals.length > 2) {
      throw new UsageError('usage: drizzle-migration-lint explain <rule-id>');
    }
  } else if ((command !== 'check' && command !== 'baseline') || positionals.length > 1) {
    throw new UsageError(
      `unknown command "${positionals.join(' ')}" — expected "check", "baseline", or "explain"`,
    );
  }
  return {
    command,
    rule: positionals[1],
    dir: values.dir,
    dialect: parseDialect(values.dialect),
    since: values.since,
    all: values.all === true,
    config: values.config,
    format: parseFormat(values.format),
    failOn: parseFailOn(values['fail-on'] as string),
    help: values.help === true,
    version: values.version === true,
  };
}

function packageVersion(): string {
  // package.json is adjacent to dist/ in the published tarball

  const manifest = require('../package.json') as { version: string };
  return manifest.version;
}

function loadSet(io: CliIo, cli: ParsedCli, config: DmlConfig): MigrationSet {
  const location = resolveLocation(io.cwd, cli.dir, cli.dialect, config);
  return readMigrationSet(location.dir, { dialect: location.dialect });
}

async function runCheck(io: CliIo, cli: ParsedCli, config: DmlConfig): Promise<number> {
  const set = loadSet(io, cli, config);
  const scope = resolveScope(set, { since: cli.since, all: cli.all, baseline: config.baseline });
  const result = await lint(set, {
    severityOverrides: config.rules,
    inScope: scope.inScope,
    extraDiagnostics: scope.diagnostics,
  });
  const format = cli.format ?? defaultReporter(io.env);
  io.stdout(REPORTERS[format](result));
  return computeExitCode(result, cli.failOn);
}

function runBaselineCommand(io: CliIo, cli: ParsedCli, config: DmlConfig): number {
  const set = loadSet(io, cli, config);
  const { tag, path } = runBaseline(io.cwd, set, cli.config);
  io.stdout(`baseline set to "${tag}" in ${path}`);
  return EXIT_CLEAN;
}

export async function runCli(argv: string[], io: CliIo): Promise<number> {
  let cli: ParsedCli;
  try {
    cli = parseCliArgs(argv);
  } catch (error) {
    io.stderr(`${(error as Error).message}\n\n${USAGE}`);
    return EXIT_USAGE;
  }
  if (cli.help) {
    io.stdout(USAGE);
    return EXIT_CLEAN;
  }
  if (cli.version) {
    io.stdout(packageVersion());
    return EXIT_CLEAN;
  }
  try {
    if (cli.command === 'explain') {
      io.stdout(explainRule(cli.rule));
      return EXIT_CLEAN;
    }
    const { config } = loadConfig(io.cwd, cli.config);
    return cli.command === 'baseline'
      ? runBaselineCommand(io, cli, config)
      : await runCheck(io, cli, config);
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr(error.message);
      return EXIT_USAGE;
    }
    /* c8 ignore start -- defensive: the readers wrap every failure in UsageError,
       so this catches only genuinely unexpected bugs rather than a normal path */
    io.stderr(`unexpected error: ${(error as Error).message}`);
    return EXIT_USAGE;
  }
  /* c8 ignore stop */
}

/* c8 ignore start -- the bin entry itself is exercised by the spawned e2e tests */
if (require.main === module) {
  runCli(process.argv.slice(2), {
    stdout: (text) => process.stdout.write(`${text}\n`),
    stderr: (text) => process.stderr.write(`${text}\n`),
    cwd: process.cwd(),
    env: process.env,
  }).then((code) => {
    process.exitCode = code;
  });
}
/* c8 ignore stop */
