import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { explainRule } from '../../src/explain';
import { RULE_IDS } from '../../src/rules';
import { tempTree } from '../support/tmp';

const REAL_DOC = join(__dirname, '..', '..', 'docs', 'rules.md');

test('explain returns the docs section for a mid-document rule', () => {
  const text = explainRule('drop-column', REAL_DOC);
  assert.match(text, /^## drop-column/);
  assert.match(text, /rolling-deploy/i);
  // stops at the next section
  assert.doesNotMatch(text, /## drop-table/);
});

test('explain handles the last rule in the document (no following section)', () => {
  const text = explainRule('truncate-in-migration', REAL_DOC);
  assert.match(text, /^## truncate-in-migration/);
  assert.match(text, /TRUNCATE/);
});

test('every registered rule has a docs section', () => {
  for (const rule of RULE_IDS) {
    assert.doesNotThrow(() => explainRule(rule, REAL_DOC), `missing docs section for ${rule}`);
  }
});

test('explain rejects a missing rule id', () => {
  assert.throws(() => explainRule(undefined), /usage: .*explain <rule-id>/);
});

test('explain rejects an unknown rule id, listing the known ones', () => {
  assert.throws(() => explainRule('not-a-rule'), /unknown rule "not-a-rule".*drop-column/s);
});

test('explain reports when a known rule has no section in the given doc', () => {
  const { dir, cleanup } = tempTree({ 'rules.md': '# Rules\n\n## drop-table\n\nonly this one\n' });
  try {
    // drop-column is a real rule, but absent from this doc
    assert.throws(() => explainRule('drop-column', join(dir, 'rules.md')), /no documentation section/);
  } finally {
    cleanup();
  }
});
