import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createVault, openVault, encryptData, decryptData, newRecoveryKey, normalizeRecoveryKey,
  validPasscode, wrapWithBytes, unwrapWithBytes, randomBytes, PASS_ITERATIONS,
} from '../js/crypto.js';
import { makeBackup, parseBackup, readBackup, backupDue } from '../js/backup.js';
import { freshState } from '../js/store.js';
import { alertTriggers, buildICS } from '../js/recurring.js';
import { renameCategory, deleteCategory, addCategory } from '../js/ops.js';

const FAST = { passIter: 1000, recIter: 1000 };

function sample() {
  const s = freshState();
  s.entries.push({ id: 'e1', type: 'expense', name: 'Coffee', cents: 450, at: '2026-11-08T09:00', category: 'Eating Out', note: 'with Sam', createdAt: '' });
  return s;
}

test('passcodes are 6 to 12 digits', () => {
  for (const ok of ['123456', '000000', '123456789012']) assert.ok(validPasscode(ok));
  for (const bad of ['12345', '1234567890123', '12345a', '', ' 123456', null]) assert.ok(!validPasscode(bad));
});

test('recovery keys are 32 readable characters and forgive sloppy typing', () => {
  const k = newRecoveryKey();
  assert.match(k, /^([0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4}$/);
  assert.equal(normalizeRecoveryKey(k.toLowerCase().replace(/-/g, ' ')), k);
  assert.equal(normalizeRecoveryKey(k.replace(/0/g, 'O').replace(/1/g, 'l')), k);
  assert.equal(normalizeRecoveryKey('too short'), null);
  assert.notEqual(newRecoveryKey(), newRecoveryKey());
});

test('data encrypts and decrypts exactly; nothing readable is left in the locked data', async () => {
  const s = sample();
  const rk = newRecoveryKey();
  const { vault, dataKey } = await createVault(s, '482915', rk, FAST);
  const text = JSON.stringify(vault);
  assert.ok(!text.includes('Coffee'));
  assert.ok(!text.includes('with Sam'));
  assert.ok(!text.includes('482915'));
  assert.ok(!text.includes(rk));
  assert.deepEqual(await decryptData(dataKey, vault.data), s);
});

test('the right passcode or recovery key opens it; wrong ones do not', async () => {
  const rk = newRecoveryKey();
  const { vault, dataKey } = await createVault(sample(), '482915', rk, FAST);
  assert.deepEqual(await openVault(vault, '482915'), dataKey);
  assert.deepEqual(await openVault(vault, rk.toLowerCase()), dataKey);
  assert.equal(await openVault(vault, '482916'), null);
  assert.equal(await openVault(vault, '000000'), null);
  assert.equal(await openVault(vault, newRecoveryKey()), null);
  assert.equal(await openVault(vault, 'hello'), null);
});

test('real-strength passcode stretching works (600,000 rounds)', async () => {
  assert.equal(PASS_ITERATIONS, 600000);
  const rk = newRecoveryKey();
  const { vault, dataKey } = await createVault(sample(), '24681357', rk);
  assert.equal(vault.pass.iter, 600000);
  assert.deepEqual(await openVault(vault, '24681357'), dataKey);
});

test('tampered data is refused rather than shown', async () => {
  const { vault, dataKey } = await createVault(sample(), '482915', newRecoveryKey(), FAST);
  const bad = { ...vault.data, ct: vault.data.ct.slice(0, -4) + (vault.data.ct.endsWith('AAAA') ? 'BBBB' : 'AAAA') };
  await assert.rejects(decryptData(dataKey, bad));
});

test('Face ID secret locks and unlocks the data key', async () => {
  const dataKey = randomBytes(32);
  const prf = randomBytes(32);
  const w = await wrapWithBytes(dataKey, prf);
  assert.deepEqual(await unwrapWithBytes(w, prf), dataKey);
  await assert.rejects(unwrapWithBytes(w, randomBytes(32)));
});

test('encrypted backup round-trip with passcode and with recovery key', async () => {
  const s = sample();
  const rk = newRecoveryKey();
  const { vault, dataKey } = await createVault(s, '135790', rk, FAST);
  const file = JSON.stringify(await makeBackup({ state: s, vault, dataKey }));
  assert.ok(!file.includes('Coffee'));
  const parsed = parseBackup(file);
  assert.ok(parsed.ok);
  assert.ok(parsed.backup.encrypted);
  const a = await readBackup(parsed.backup, '135790');
  assert.ok(a.ok);
  assert.deepEqual(a.state.entries, s.entries);
  const b = await readBackup(parsed.backup, rk);
  assert.ok(b.ok);
  const c = await readBackup(parsed.backup, '111111');
  assert.equal(c.ok, false);
});

test('plain backup (no passcode yet) and bad files', async () => {
  const s = sample();
  const parsed = parseBackup(JSON.stringify(await makeBackup({ state: s })));
  assert.ok(parsed.ok);
  const r = await readBackup(parsed.backup);
  assert.deepEqual(r.state.entries, s.entries);
  assert.equal(parseBackup('not json').ok, false);
  assert.equal(parseBackup('{"format":"something-else"}').ok, false);
  assert.equal(parseBackup(JSON.stringify({ format: 'my-budget-backup', version: 1, encrypted: true })).ok, false);
});

test('backup reminder after 7 days, only when there is data and it is switched on', () => {
  const st = { backupReminder: true, lastBackupAt: '2026-11-01T10:00' };
  assert.equal(backupDue(st, true, '2026-11-07T23:59'), null);
  assert.equal(backupDue(st, true, '2026-11-08T00:00'), 7);
  assert.equal(backupDue({ ...st, lastBackupAt: null }, true, '2026-11-08T00:00'), Infinity);
  assert.equal(backupDue({ ...st, backupReminder: false }, true, '2026-12-08T00:00'), null);
  assert.equal(backupDue(st, false, '2026-12-08T00:00'), null);
});

test('calendar alerts follow Settings → Alerts', () => {
  assert.deepEqual(alertTriggers({}), ['-P1D', '-PT1H']);
  assert.deepEqual(alertTriggers({ alertDays: 3, alertMinutes: 30 }), ['-P3D', '-PT30M']);
  assert.deepEqual(alertTriggers({ alertDays: 0, alertMinutes: 120 }), ['-PT2H']);
  assert.deepEqual(alertTriggers({ alertDays: 0, alertMinutes: 0 }), []);
  const ics = buildICS({ id: 'b', name: 'Back up', cents: 0, freq: 'weekly', anchor: '2026-11-15T09:00', nextIndex: 0, endAt: null }, { alerts: alertTriggers({ alertDays: 2, alertMinutes: 15 }), stampNow: new Date(0) });
  assert.match(ics, /TRIGGER:-P2D/);
  assert.match(ics, /TRIGGER:-PT15M/);
});

test('renaming a category updates entries, schedules, limits and moves', () => {
  const s = sample();
  s.limits['Eating Out'] = 10000;
  s.recurring.push({ id: 'r', type: 'expense', category: 'Eating Out' });
  s.adjustments.push({ id: 'a', month: '2026-11-01T00:00', from: 'Shopping', to: 'Eating Out', cents: 100 });
  assert.ok(renameCategory(s, 'expense', 'Eating Out', 'Restaurants'));
  assert.ok(s.categories.expense.includes('Restaurants'));
  assert.ok(!s.categories.expense.includes('Eating Out'));
  assert.equal(s.entries[0].category, 'Restaurants');
  assert.equal(s.recurring[0].category, 'Restaurants');
  assert.equal(s.limits.Restaurants, 10000);
  assert.ok(!('Eating Out' in s.limits));
  assert.equal(s.adjustments[0].to, 'Restaurants');
  assert.equal(renameCategory(s, 'expense', 'Restaurants', 'Groceries'), false, 'no duplicates');
  assert.equal(renameCategory(s, 'income', 'Paycheck', 'Pay'), false, 'Paycheck is fixed');
});

test('deleting and adding categories', () => {
  const s = sample();
  s.limits.Fun = 500;
  assert.ok(deleteCategory(s, 'expense', 'Fun'));
  assert.ok(!('Fun' in s.limits));
  assert.equal(deleteCategory(s, 'income', 'Paycheck'), false);
  assert.ok(addCategory(s, 'expense', 'Pets'));
  assert.equal(addCategory(s, 'expense', 'Pets'), false);
  s.categories.expense = ['Only'];
  assert.equal(deleteCategory(s, 'expense', 'Only'), false, 'keeps at least one');
});
