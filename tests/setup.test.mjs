// tools/setup.mjs: the pure decisions (version comparison, staleness). npm is not run.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareVersions, dependenciesHash, installReason, nodeIsEnough, parseVersion } from '../tools/setup.mjs';

test('версии: разбор и сравнение', () => {
  assert.deepEqual(parseVersion('v22.18.0'), [22, 18, 0]);
  assert.deepEqual(parseVersion('>=22.18'), [22, 18, 0]);
  assert.ok(compareVersions('v22.9.0', '22.18') < 0);
  assert.ok(compareVersions('v22.18.1', '22.18') > 0);
  assert.equal(compareVersions('v24.0.0', '24'), 0);
});

test('Node: подходит ли версия под engines', () => {
  assert.equal(nodeIsEnough('v26.13.0', '>=22.18'), true);
  assert.equal(nodeIsEnough('v22.18.0', '>=22.18'), true);
  assert.equal(nodeIsEnough('v22.17.9', '>=22.18'), false);
  assert.equal(nodeIsEnough('v20.19.0', '>=22.18'), false);
  assert.throws(() => nodeIsEnough('v22.18.0', '^22'), /engines\.node/);
  assert.throws(() => nodeIsEnough('v22.18.0', undefined), /engines\.node/);
});

test('хеш зависимостей: меняется от зависимостей, не от прочих полей', () => {
  const base = { name: 'a', dependencies: { sharp: '1.0.0' }, devDependencies: {}, engines: { node: '>=22' } };
  const h = dependenciesHash(JSON.stringify(base));
  assert.equal(dependenciesHash(JSON.stringify({ ...base, name: 'b', scripts: { x: 'y' } })), h);
  assert.notEqual(dependenciesHash(JSON.stringify({ ...base, dependencies: { sharp: '1.0.1' } })), h);
});

test('установка: когда нужна', () => {
  const ok = { hasModules: true, stamp: { hash: 'h' }, hash: 'h', missing: [] };
  assert.equal(installReason(ok), null);
  assert.match(installReason({ ...ok, hasModules: false }), /node_modules/);
  assert.match(installReason({ ...ok, missing: ['sharp'] }), /sharp/);
  assert.match(installReason({ ...ok, stamp: null }), /отметки/);
  assert.match(installReason({ ...ok, hash: 'other' }), /package\.json/);
});
