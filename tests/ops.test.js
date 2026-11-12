import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshState } from '../js/store.js';
import { addEntry, updateEntry, deleteEntry, runRecurring, addRule, editFuture, deleteFuture, editRule, stopRule } from '../js/ops.js';
import { monthSummary, receiptTotal } from '../js/calc.js';
import { budgetMonth } from '../js/dates.js';
import { nextOccurrence } from '../js/recurring.js';

let n = 0;
const id = () => `id${++n}`;

function setup() {
  const s = freshState();
  s.goals.push({ id: 'g1', name: 'New shoes', targetCents: 15000 });
  s.settings.autoSave = [{ goalId: 'g1', bp: 1000 }];
  return s;
}

const pay = (cents, at) => ({ id: id(), type: 'income', name: 'Paycheck', cents, at, category: 'Paycheck', note: '' });

test('logging a paycheck moves the auto-save share to the goal', () => {
  const s = setup();
  addEntry(s, pay(81235, '2026-11-07T09:00'), id);
  const saving = s.entries.find((e) => e.type === 'saving');
  assert.equal(saving.cents, 8123);
  assert.equal(saving.goalId, 'g1');
  const sum = monthSummary(s.entries, budgetMonth('2026-11-08T10:00'), '2026-11-08T10:00');
  assert.equal(sum.moneyIn.value, 81235);
  assert.equal(sum.saved.value, -8123);
  assert.equal(sum.left.value, 73112);
  assert.equal(receiptTotal(sum.left.receipt), 73112);
});

test('other income is not split', () => {
  const s = setup();
  addEntry(s, { ...pay(5000, '2026-11-07T09:00'), category: 'Other income' }, id);
  assert.equal(s.entries.length, 1);
});

test('editing a paycheck amount updates its savings; deleting removes both', () => {
  const s = setup();
  const p = pay(80000, '2026-11-07T09:00');
  addEntry(s, p, id);
  updateEntry(s, { ...p, cents: 90000 }, id);
  assert.equal(s.entries.find((e) => e.type === 'saving').cents, 9000);
  s.settings.autoSave = [{ goalId: 'g1', bp: 2000 }]; // changing the setting later doesn't rewrite past paychecks
  updateEntry(s, { ...p, cents: 90000, name: 'Pay' }, id);
  assert.equal(s.entries.find((e) => e.type === 'saving').cents, 9000);
  deleteEntry(s, p.id);
  assert.equal(s.entries.length, 0);
});

test('recurring paychecks are added on payday with savings, and listed in the welcome notice', () => {
  const s = setup();
  addRule(s, { id: 'r1', type: 'income', kind: 'paycheck', name: 'Paycheck', cents: 124000, category: 'Paycheck', freq: 'biweekly', anchor: '2026-11-20T09:00', nextIndex: 0, endAt: null }, '2026-11-08T10:00', id);
  assert.equal(s.entries.length, 0, 'not yet');
  const added = runRecurring(s, '2026-12-04T09:00', id);
  assert.deepEqual(added.map((e) => e.at), ['2026-11-20T09:00', '2026-12-04T09:00']);
  assert.equal(s.entries.filter((e) => e.type === 'saving').length, 2);
  assert.deepEqual(s.notice, added.map((e) => e.id));
  assert.equal(runRecurring(s, '2026-12-04T09:00', id).length, 0, 'no duplicates');
});

test('a rule that started in the past fills in right away, without a notice', () => {
  const s = setup();
  addRule(s, { id: 'r2', type: 'expense', kind: 'bill', name: 'Rent', cents: 110000, category: 'Housing', freq: 'monthly', anchor: '2026-10-01T09:00', nextIndex: 0, endAt: null }, '2026-11-08T10:00', id);
  assert.equal(s.entries.length, 2);
  assert.equal(s.notice.length, 0);
});

test('"this and all future ones" changes the schedule from that entry on, without duplicates', () => {
  const s = setup();
  addRule(s, { id: 'r3', type: 'expense', kind: 'bill', name: 'Rent', cents: 110000, category: 'Housing', freq: 'monthly', anchor: '2026-09-01T09:00', nextIndex: 0, endAt: null }, '2026-11-08T10:00', id);
  const oct = s.entries.find((e) => e.at === '2026-10-01T09:00');
  editFuture(s, oct.id, { ...oct, cents: 115000 }, '2026-11-08T10:00', id);
  const rents = s.entries.filter((e) => e.name === 'Rent').sort((a, b) => (a.at < b.at ? -1 : 1));
  assert.deepEqual(rents.map((e) => [e.at, e.cents]), [
    ['2026-09-01T09:00', 110000], ['2026-10-01T09:00', 115000], ['2026-11-01T09:00', 115000],
  ]);
  runRecurring(s, '2026-12-01T09:00', id);
  assert.equal(s.entries.filter((e) => e.at === '2026-12-01T09:00').length, 1);
  assert.equal(s.entries.find((e) => e.at === '2026-12-01T09:00').cents, 115000);
});

test('"just this one" edits leave the schedule alone', () => {
  const s = setup();
  addRule(s, { id: 'r4', type: 'expense', kind: 'bill', name: 'Phone', cents: 5000, category: 'Bills', freq: 'monthly', anchor: '2026-10-15T09:00', nextIndex: 0, endAt: null }, '2026-11-08T10:00', id);
  const e = s.entries[0];
  updateEntry(s, { ...e, cents: 6500 }, id);
  runRecurring(s, '2026-11-15T09:00', id);
  assert.deepEqual(s.entries.map((x) => x.cents), [6500, 5000]);
});

test('deleting from here on stops the schedule', () => {
  const s = setup();
  addRule(s, { id: 'r5', type: 'expense', kind: 'subscription', name: 'Gym', cents: 4000, category: 'Health', freq: 'monthly', anchor: '2026-09-05T09:00', nextIndex: 0, endAt: null }, '2026-11-08T10:00', id);
  const oct = s.entries.find((e) => e.at === '2026-10-05T09:00');
  deleteFuture(s, oct.id);
  assert.deepEqual(s.entries.map((e) => e.at), ['2026-09-05T09:00']);
  assert.equal(runRecurring(s, '2027-06-01T00:00', id).length, 0);
});

test('editing or stopping a schedule from Reminders only affects future dates', () => {
  const s = setup();
  addRule(s, { id: 'r6', type: 'expense', kind: 'subscription', name: 'Netflix', cents: 1899, category: 'Bills', freq: 'monthly', anchor: '2026-10-03T09:00', nextIndex: 0, endAt: null }, '2026-11-08T10:00', id);
  editRule(s, 'r6', { cents: 2299, anchor: '2026-12-03T09:00' }, '2026-11-08T10:00', id);
  runRecurring(s, '2026-12-03T09:00', id);
  assert.deepEqual(s.entries.map((e) => [e.at, e.cents]), [['2026-10-03T09:00', 1899], ['2026-11-03T09:00', 1899], ['2026-12-03T09:00', 2299]]);
  const live = s.recurring.find((r) => nextOccurrence(r));
  stopRule(s, live.id);
  assert.equal(runRecurring(s, '2027-06-01T00:00', id).length, 0);
  assert.equal(s.entries.length, 3);
});
