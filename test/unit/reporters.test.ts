import assert from 'node:assert/strict';
import { test } from 'node:test';
import { REPORTERS, isReporterName } from '../../src/reporters';
import { makeStyler, renderPretty } from '../../src/reporters/pretty';
import { renderJson } from '../../src/reporters/json';
import type { Finding, LintResult } from '../../src/types';

function finding(over: Partial<Finding> = {}): Finding {
  return {
    rule: 'truncate-in-migration',
    severity: 'warn',
    message: 'TRUNCATE destroys data.',
    suggestion: 'move it to an operational script',
    file: '0001_evolve.sql',
    line: 3,
    migration: '0001_evolve',
    suppressed: false,
    docsUrl: 'https://example/docs#truncate-in-migration',
    ...over,
  };
}

function resultWith(findings: Finding[], extra: Partial<LintResult> = {}): LintResult {
  const active = findings.filter((f) => !f.suppressed);
  return {
    findings,
    diagnostics: extra.diagnostics ?? [],
    summary: extra.summary ?? {
      errors: active.filter((f) => f.severity === 'error').length,
      warnings: active.filter((f) => f.severity === 'warn').length,
      suppressed: findings.length - active.length,
      migrationsChecked: 2,
    },
  };
}

test('isReporterName recognizes the built-ins only', () => {
  assert.equal(isReporterName('pretty'), true);
  assert.equal(isReporterName('json'), true);
  assert.equal(isReporterName('yaml'), false);
});

test('json reporter emits the stable v1 envelope', () => {
  const parsed = JSON.parse(renderJson(resultWith([finding()])));
  assert.equal(parsed.version, 1);
  assert.equal(parsed.findings.length, 1);
  assert.deepEqual(Object.keys(parsed.summary).sort(), [
    'errors',
    'migrationsChecked',
    'suppressed',
    'warnings',
  ]);
});

test('makeStyler returns identity when style is unsupported', () => {
  const style = makeStyler({}, false);
  assert.equal(style('red', 'x'), 'x');
});

test('makeStyler respects NO_COLOR even when style is supported', () => {
  const style = makeStyler({ NO_COLOR: '1' }, true);
  assert.equal(style('red', 'x'), 'x');
});

test('makeStyler routes through styleText when supported and NO_COLOR is unset', () => {
  const style = makeStyler({}, true);
  // util.styleText itself decides whether to emit ANSI (only on a real TTY),
  // so we assert the text survives the call rather than a specific escape.
  assert.match(style('red', 'boom'), /boom/);
});

test('pretty reporter groups by file and prints suggestions and docs', () => {
  const out = renderPretty(resultWith([finding()]), { NO_COLOR: '1' });
  assert.match(out, /0001_evolve\.sql/);
  assert.match(out, /TRUNCATE destroys data\./);
  assert.match(out, /→ move it to an operational script/);
  assert.match(out, /example\/docs#truncate-in-migration/);
  assert.match(out, /1 warning /);
  assert.match(out, /2 migrations checked/);
});

test('pretty reporter marks suppressed findings and counts them', () => {
  const out = renderPretty(resultWith([finding({ suppressed: true })]), { NO_COLOR: '1' });
  assert.match(out, /\(suppressed\)/);
  assert.match(out, /1 suppressed/);
});

test('pretty reporter announces a clean run', () => {
  const out = renderPretty(resultWith([]), { NO_COLOR: '1' });
  assert.match(out, /No unsafe operations found\./);
});

test('pretty reporter renders diagnostics with and without a migration scope', () => {
  const out = renderPretty(
    resultWith([], {
      diagnostics: [
        { code: 'missing-snapshot', message: 'gone', migration: '0002_x' },
        { code: 'parallel-branches', message: 'two heads' },
      ],
    }),
    { NO_COLOR: '1' },
  );
  assert.match(out, /diagnostic missing-snapshot \[0002_x\]: gone/);
  assert.match(out, /diagnostic parallel-branches: two heads/);
});

test('pretty reporter pluralizes error/warning counts', () => {
  const out = renderPretty(
    resultWith([finding({ severity: 'error' }), finding({ severity: 'error', line: 5 })]),
    { NO_COLOR: '1' },
  );
  assert.match(out, /2 errors, 0 warnings/);
});

test('pretty reporter appends suppressed count alongside active findings', () => {
  const out = renderPretty(
    resultWith([finding({ severity: 'error' }), finding({ severity: 'warn', suppressed: true, line: 7 })]),
    { NO_COLOR: '1' },
  );
  assert.match(out, /1 error, 0 warnings, 1 suppressed/);
});

test('REPORTERS map dispatches by name', () => {
  assert.equal(typeof REPORTERS.pretty(resultWith([])), 'string');
  assert.equal(JSON.parse(REPORTERS.json(resultWith([]))).version, 1);
});
