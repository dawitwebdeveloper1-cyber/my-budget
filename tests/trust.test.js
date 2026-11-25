import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCSV, centsText, checkBackup, lockDelayMs, undoImport } from '../js/trust.js';
import { createVault, newRecoveryKey } from '../js/crypto.js';
import { makeBackup } from '../js/backup.js';
import { freshState, cleanState } from '../js/store.js';
import { addEntry } from '../js/ops.js';

const FAST = { passIter: 1000, recIter: 1000 };
const NOW = '2026-11-25T12:00';

function sample() {
  const s = freshState();
  s.goals.push({ id: 'car', name: 'Car', targetCents: 100000, createdAt: '' });
  s.entries.push(
    { id: 'a', type: 'expense', name: 'Coffee, large', cents: 450, at: '2026-11-08T09:05', category: 'Eating Out', note: 'with "Sam"', createdAt: '' },
    { id: 'b', type: 'income', name: 'Paycheck', cents: 124001, at: '2026-11-06T09:00', category: 'Paycheck', note: '', createdAt: '' },
    { id: 'c', type: 'saving', name: 'To Car', cents: 5, at: '2026-11-07T10:00', category: 'Savings', note: '', goalId: 'car', createdAt: '' },
    { id: 'd', type: 'refund', name: '=HYPERLINK("x")', cents: 1299, at: '2026-11-09T15:30', category: 'Shopping', note: '', createdAt: '' },
    { id: 'f', type: 'expense', name: 'Future rent', cents: 150000, at: '2026-12-01T09:00', category: 'Housing', note: '', createdAt: '' },
  );
  return s;
}

// ---------- Spreadsheet ----------
test('spreadsheet: every entry so far, in date order, exact amounts with signs', () => {
  const csv = toCSV(sample(), NOW);
  assert.ok(csv.startsWith('﻿Date,Time,Type,Name,Category,Amount,Owed to you,Cash,Goal,Repeating,Note\r\n'));
  const lines = csv.slice(1).trim().split('\r\n');
  assert.equal(lines.length, 5, 'header + 4 entries (the future one is left out)');
  assert.equal(lines[1], '2026-11-06,9:00 AM,Money in,Paycheck,Paycheck,1240.01,,,,,');
  assert.equal(lines[2], '2026-11-07,10:00 AM,To savings,To Car,Savings,-0.05,,,Car,,');
  assert.equal(lines[3], '2026-11-08,9:05 AM,Money out,"Coffee, large",Eating Out,-4.50,,,,,"with ""Sam"""');
});

test('spreadsheet: text that looks like a formula can never run', () => {
  const csv = toCSV(sample(), NOW);
  assert.match(csv, /,"'=HYPERLINK\(""x""\)",Shopping,12\.99,/);
  assert.ok(!/,=HYPERLINK/.test(csv));
});

test('amounts are built from whole cents, never rounded', () => {
  assert.equal(centsText(0), '0.00');
  assert.equal(centsText(5), '0.05');
  assert.equal(centsText(-100), '-1.00');
  assert.equal(centsText(123456789), '1234567.89');
  for (let i = 0; i < 500; i++) {
    const c = Math.floor(Math.random() * 2e9) - 1e9;
    assert.equal(Math.round(Number(centsText(c)) * 100), c);
  }
});

// ---------- Checking a backup ----------
test('checking a plain backup: opens it, compares, changes nothing', async () => {
  const s = sample();
  const text = JSON.stringify(await makeBackup({ state: s }));
  const before = JSON.stringify(s);
  const r = await checkBackup(text, { state: s });
  assert.equal(r.ok, true);
  assert.deepEqual(r.inFile, { entries: 5, goals: 1, schedules: 0 });
  assert.equal(r.same, true);
  assert.equal(JSON.stringify(s), before);
  s.entries.pop();
  assert.equal((await checkBackup(text, { state: s })).same, false, 'things changed since: still opens, just different');
});

test('checking an encrypted backup: opens with the key in memory, or asks for the passcode', async () => {
  const s = sample();
  const rk = newRecoveryKey();
  const { vault, dataKey } = await createVault(s, '482915', rk, FAST);
  const text = JSON.stringify(await makeBackup({ state: s, vault, dataKey }));
  const a = await checkBackup(text, { state: s, dataKey });
  assert.equal(a.ok, true);
  assert.equal(a.encrypted, true);
  assert.equal(a.same, true);
  const b = await checkBackup(text, { state: s });
  assert.equal(b.needsSecret, true);
  assert.equal((await checkBackup(text, { state: s, secret: '482915' })).ok, true);
  assert.equal((await checkBackup(text, { state: s, secret: '000000' })).ok, false);
});

test('a damaged or wrong file is reported, not crashed on', async () => {
  assert.equal((await checkBackup('not json', { state: sample() })).ok, false);
  assert.equal((await checkBackup('{"format":"something else"}', { state: sample() })).ok, false);
});

// ---------- Lock timer ----------
test('lock timer: right away, 1, 5 or 15 minutes; anything else means 1 minute', () => {
  assert.equal(lockDelayMs({ lockAfter: 0 }), 0);
  assert.equal(lockDelayMs({ lockAfter: 5 }), 300_000);
  assert.equal(lockDelayMs({ lockAfter: 15 }), 900_000);
  assert.equal(lockDelayMs({ lockAfter: 7 }), 60_000);
  assert.equal(lockDelayMs({}), 60_000);
  assert.equal(cleanState({ settings: { lockAfter: 5 } }).settings.lockAfter, 5);
  assert.equal(cleanState({ settings: { lockAfter: 3 } }).settings.lockAfter, 1);
});

// ---------- Undo a whole import ----------
test('undoing an import removes exactly that batch (and any auto-savings from it)', () => {
  const s = freshState();
  s.goals.push({ id: 'car', name: 'Car', targetCents: 100000, createdAt: '' });
  s.settings.autoSave = [{ goalId: 'car', bp: 1000 }];
  s.entries.push({ id: 'mine', type: 'expense', name: 'Lunch', cents: 1200, at: '2026-11-10T12:00', category: 'Eating Out', note: '' });
  let n = 0;
  const id = () => `x${++n}`;
  for (let i = 0; i < 200; i++) addEntry(s, { id: id(), type: 'expense', name: `Row ${i}`, cents: 100 + i, at: '2026-11-11T12:00', category: 'Other', note: '', imported: true, importBatch: 'B1' }, id);
  addEntry(s, { id: id(), type: 'income', name: 'Pay', cents: 100000, at: '2026-11-12T12:00', category: 'Paycheck', note: '', imported: true, importBatch: 'B1' }, id);
  s.lastImport = { batch: 'B1', count: 201, at: NOW };
  assert.equal(s.entries.length, 1 + 201 + 1, 'the imported paycheck also auto-saved');
  const removed = undoImport(s, 'B1');
  assert.equal(removed, 202);
  assert.deepEqual(s.entries.map((e) => e.id), ['mine']);
  assert.equal(s.lastImport, null);
  assert.equal(cleanState({ entries: [{ id: 'z', type: 'expense', name: 'Z', cents: 1, at: NOW, category: 'Other', importBatch: 'B9' }], lastImport: { batch: 'B9', count: 1, at: NOW } }).lastImport.batch, 'B9');
});
