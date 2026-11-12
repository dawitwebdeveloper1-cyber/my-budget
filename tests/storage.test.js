import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initStorage, memoryBackend, getItem, setItem, flushStorage, keys } from '../js/storage.js';
import {
  load, save, freshState, listCopies, restoreCopy, upgradeRaw, fromSaved, DATA_VERSION, savedVersion, keepCopy,
} from '../js/store.js';
import { makeBackup, parseBackup, readBackup } from '../js/backup.js';
import { createVault, newRecoveryKey } from '../js/crypto.js';

// A stand-in for the browser's old simple storage.
class FakeLocalStorage {
  constructor(entries = {}) { this.m = new Map(Object.entries(entries)); }
  get length() { return this.m.size; }
  key(i) { return [...this.m.keys()][i] ?? null; }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}

// Stage 1 data, saved before goals, schedules, limits or passcodes existed.
const STAGE1 = JSON.stringify({
  version: 1,
  entries: [
    { id: 'a', type: 'expense', name: 'No Frills', cents: 5425, at: '2026-11-08T21:52', category: 'Groceries', note: '', createdAt: '' },
    { id: 'b', type: 'income', name: 'Paycheck', cents: 124000, at: '2026-11-07T09:00', category: 'Paycheck', note: '', createdAt: '' },
  ],
  categories: { expense: ['Housing', 'Groceries'], income: ['Paycheck'] },
  settings: { monthStartDay: 1, weekStartDay: 1 },
});

function sampleState() {
  const s = freshState();
  s.entries.push({ id: 'x', type: 'expense', name: 'Coffee ☕', cents: 450, at: '2026-11-12T23:59', category: 'Eating Out', note: 'with "Sam"', createdAt: '2026-11-12T23:59:30.000Z' });
  s.goals.push({ id: 'g', name: 'Car', targetCents: 200000, createdAt: '' });
  s.limits.Groceries = 40000;
  s.recurring.push({ id: 'r', type: 'expense', kind: 'bill', name: 'Rent', cents: 110000, category: 'Housing', freq: 'monthly', anchor: '2026-12-01T09:00', nextIndex: 0, endAt: null });
  s.settings.autoSaveBp = 1000;
  s.settings.autoSaveGoalId = 'g';
  return s;
}

test('data survives closing and reopening the app', async () => {
  const device = new Map();
  await initStorage({ backend: memoryBackend(device), legacy: null });
  const s = sampleState();
  save(s);
  await flushStorage();
  // "restart": a brand new start-up reading the same device
  await initStorage({ backend: memoryBackend(device), legacy: null });
  assert.deepEqual(load(), s);
});

test('old data moves from the old storage, and the old copy is removed only after checking', async () => {
  const device = new Map();
  const ls = new FakeLocalStorage({ 'mybudget.v1': STAGE1, unrelated: 'keep me' });
  await initStorage({ backend: memoryBackend(device), legacy: ls });
  assert.equal(device.get('mybudget.v1'), STAGE1, 'copied exactly');
  assert.equal(ls.getItem('mybudget.v1'), null, 'old copy removed');
  assert.equal(ls.getItem('unrelated'), 'keep me', 'nothing else touched');
  // running again changes nothing
  await initStorage({ backend: memoryBackend(device), legacy: ls });
  assert.equal(device.get('mybudget.v1'), STAGE1);
});

test('if the new storage fails, nothing is lost and the app keeps using the old storage', async () => {
  const ls = new FakeLocalStorage({ 'mybudget.v1': STAGE1 });
  const kind = await initStorage({ backend: memoryBackend(new Map(), { failWrites: true }), legacy: ls });
  assert.equal(kind, 'localstorage');
  assert.equal(ls.getItem('mybudget.v1'), STAGE1, 'old copy still there');
  assert.equal(getItem('mybudget.v1'), STAGE1, 'app can still read it');
});

test('a half-finished earlier move never wins over newer data', async () => {
  const device = new Map([['mybudget.v1', '{"version":2,"entries":[],"stale":true}']]);
  const newer = JSON.stringify({ version: 2, entries: [], newer: true });
  const ls = new FakeLocalStorage({ 'mybudget.v1': newer });
  await initStorage({ backend: memoryBackend(device), legacy: ls });
  assert.equal(device.get('mybudget.v1'), newer);
  assert.match(device.get('mybudget.legacy-copy.mybudget.v1'), /stale/, 'the other copy is kept too');
});

test('with a passcode vault, no unencrypted copy is left behind', async () => {
  const device = new Map();
  const ls = new FakeLocalStorage({ 'mybudget.v1': STAGE1, 'mybudget.vault': '{"v":1}' });
  await initStorage({ backend: memoryBackend(device), legacy: ls });
  await flushStorage();
  assert.ok(device.has('mybudget.vault'));
  assert.ok(!device.has('mybudget.v1'));
  assert.equal(ls.length, 0);
});

test('old data converts to the current version, with a copy kept first', async () => {
  const device = new Map([['mybudget.v1', STAGE1]]);
  await initStorage({ backend: memoryBackend(device), legacy: null });
  const s = load();
  assert.equal(s.version, DATA_VERSION);
  assert.equal(s.entries.length, 2);
  assert.equal(s.entries[0].cents, 5425);
  assert.deepEqual(s.goals, []);
  assert.deepEqual(s.recurring, []);
  assert.deepEqual(s.categories.expense, ['Housing', 'Groceries']);
  const copies = listCopies();
  assert.equal(copies.length, 1);
  assert.equal(copies[0].fromVersion, 1);
  assert.equal(copies[0].data, STAGE1, 'exact copy of the old data');
});

test('the pre-update copy restores exactly', async () => {
  const device = new Map([['mybudget.v1', STAGE1]]);
  await initStorage({ backend: memoryBackend(device), legacy: null });
  const s = load();
  s.entries = [];
  save(s); // pretend a bad update wiped entries
  await flushStorage();
  assert.ok(await restoreCopy(listCopies()[0].key));
  await flushStorage();
  assert.equal(device.get('mybudget.v1'), STAGE1);
  assert.equal(load().entries.length, 2);
});

test('current-version data is loaded without making copies', async () => {
  const device = new Map();
  await initStorage({ backend: memoryBackend(device), legacy: null });
  save(sampleState());
  await flushStorage();
  load();
  load();
  assert.equal(listCopies().length, 0);
});

test('only the 3 newest copies are kept', async () => {
  await initStorage({ backend: memoryBackend(new Map()), legacy: null });
  for (let i = 0; i < 5; i++) keepCopy(1, `data ${i}`, 'plain', new Date(Date.UTC(2026, 10, 1 + i)));
  await flushStorage();
  assert.deepEqual(listCopies().map((c) => c.data), ['data 4', 'data 3', 'data 2']);
  assert.equal(keys().filter((k) => k.startsWith('mybudget.copy.')).length, 3);
});

test('unreadable saved data is kept as a copy, never silently thrown away', async () => {
  await initStorage({ backend: memoryBackend(new Map([['mybudget.v1', '{broken']])), legacy: null });
  assert.deepEqual(load().entries, []);
  assert.equal(listCopies()[0].data, '{broken');
});

test('every version converts step by step', () => {
  assert.equal(savedVersion({}), 1);
  assert.equal(savedVersion({ version: 2 }), 2);
  assert.equal(upgradeRaw({ entries: [] }).version, DATA_VERSION);
  assert.equal(fromSaved(JSON.parse(STAGE1)).entries.length, 2);
});

test('backup and restore give back exactly the same data (plain and encrypted)', async () => {
  const s = sampleState();
  const plain = await readBackup(parseBackup(JSON.stringify(await makeBackup({ state: s }))).backup);
  assert.deepEqual(plain.state, s);
  const { vault, dataKey } = await createVault(s, '135792', newRecoveryKey(), { passIter: 1000, recIter: 1000 });
  const enc = await readBackup(parseBackup(JSON.stringify(await makeBackup({ state: s, vault, dataKey }))).backup, '135792');
  assert.deepEqual(enc.state, s);
});

test('an old Stage 1 backup still restores', async () => {
  const b = { format: 'my-budget-backup', version: 1, encrypted: false, state: JSON.parse(STAGE1) };
  const r = await readBackup(parseBackup(JSON.stringify(b)).backup);
  assert.equal(r.state.entries.length, 2);
  assert.equal(r.state.version, DATA_VERSION);
});
