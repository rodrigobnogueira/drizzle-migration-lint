#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { resolveLocation } from './config';
import { lint } from './engine';
import { UsageError } from './errors';
import { EXIT_CLEAN, EXIT_USAGE, computeExitCode, type FailOn } from './exit-code';
import { readMigrationSet } from './formats';
import { REPORTERS, isReporterName } from './reporters';
import { normalizeDialect } from './snapshot';
import type { Dialect } from './types';

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  cwd: string;
}

const USAGE = `drizzle-migration-lint — catch drizzle-kit migrations that will lock or rewrite your production tables

Usage:
  drizzle-migration-lint [check] [options]

Options:
  --dir <path>       migrations directory (default: out from drizzle.config.*, else ./drizzle)
  --dialect <name>   only needed when the artifacts don't say (postgresql|mysql|sqlite|turso|...)
  --all              lint the entire migration history (currently always on)
  --format <name>    pretty | json (default: pretty)
  --fail-on <level>  error | warn | none (default: error)
  -h, --help         show this help
  -v, --version      print the version

Exit codes: 0 clean (or below --fail-on), 1 findings, 2 usage/environment error.`;

interface ParsedCli {
  dir: string | undefined;
  dialect: Dialect | undefined;
  format: 'pretty' | 'json';
  failOn: FailOn;
  help: boolean;
  version: boolean;
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
        all: { type: 'boolean' },
        format: { type: 'string', default: 'pretty' },
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
  if (command !== 'check' || positionals.length > 1) {
    throw new UsageError(`unknown command "${positionals.join(' ')}" — only "check" is supported`);
  }
  const format = values.format as string;
  if (!isReporterName(format)) {
    throw new UsageError(`unknown --format "${format}" (expected: pretty | json)`);
  }
  const failOn = values['fail-on'] as string;
  if (failOn !== 'error' && failOn !== 'warn' && failOn !== 'none') {
    throw new UsageError(`unknown --fail-on "${failOn}" (expected: error | warn | none)`);
  }
  let dialect: Dialect | undefined;
  if (values.dialect !== undefined) {
    dialect = normalizeDialect(values.dialect) ?? undefined;
    if (!dialect) {
      throw new UsageError(`unknown --dialect "${values.dialect}"`);
    }
  }
  return {
    dir: values.dir,
    dialect,
    format,
    failOn,
    help: values.help === true,
    version: values.version === true,
  };
}

function packageVersion(): string {
  // package.json is adjacent to dist/ in the published tarball

  const manifest = require('../package.json') as { version: string };
  return manifest.version;
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
    const location = resolveLocation(io.cwd, cli.dir, cli.dialect);
    const set = readMigrationSet(location.dir, { dialect: location.dialect });
    const result = await lint(set);
    io.stdout(REPORTERS[cli.format](result));
    return computeExitCode(result, cli.failOn);
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
  }).then((code) => {
    process.exitCode = code;
  });
}
/* c8 ignore stop */
