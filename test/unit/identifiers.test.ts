import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseTableRef, tableIdentity, unquoteIdentifier } from '../../src/identifiers';

test('unquoteIdentifier strips double quotes, backticks and brackets', () => {
  assert.equal(unquoteIdentifier('"users"'), 'users');
  assert.equal(unquoteIdentifier('`users`'), 'users');
  assert.equal(unquoteIdentifier('[users]'), 'users');
  assert.equal(unquoteIdentifier('  users  '), 'users');
});

test('tableIdentity treats public and missing schema as bare names', () => {
  assert.equal(tableIdentity(null, 'users'), 'users');
  assert.equal(tableIdentity(undefined, 'users'), 'users');
  assert.equal(tableIdentity('public', 'users'), 'users');
  assert.equal(tableIdentity('auth', 'users'), 'auth.users');
});

test('parseTableRef handles quoting, qualification and pg descendant markers', () => {
  assert.equal(parseTableRef('users'), 'users');
  assert.equal(parseTableRef('"users"'), 'users');
  assert.equal(parseTableRef('public.users'), 'users');
  assert.equal(parseTableRef('"public"."users"'), 'users');
  assert.equal(parseTableRef('auth.users'), 'auth.users');
  assert.equal(parseTableRef('`auth`.`users`'), 'auth.users');
  assert.equal(parseTableRef('users *'), 'users');
});

test('parseTableRef keeps dots inside quoted identifiers', () => {
  assert.equal(parseTableRef('"weird.name"'), 'weird.name');
  assert.equal(parseTableRef('auth."weird.name"'), 'auth.weird.name');
});

test('parseTableRef tolerates degenerate input', () => {
  assert.equal(parseTableRef(''), '');
  assert.equal(parseTableRef('db.auth.users'), 'auth.users');
});
