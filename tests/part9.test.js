// Part 9: split bills and "owed to you", cash, the extras switches, late-night and daylight-saving
// entries, and speed with 5,000 entries.
process.env.TZ = 'America/Edmonton'; // Calgary time, with real daylight-saving changes

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthSummary, periodTotals, signed, spendCents, receiptTotal } from '../js/calc.js';
import { budgetMonth, dayOf, weekOf, toStamp, addDays } from '../js/dates.js';
import { leftUntilPayday } from '../js/pay.js';
import { categoryBudgets } from '../js/budget.js';
import { addEntry, updateEntry, deleteEntry, markRepaid, unmarkRepaid, addRule } from '../js/ops.js';
import { owedToYou, cashOnHand, on, EXTRA_KEYS } from '../js/extras.js';
import { freshState, cleanState, cleanEntry, fromSaved, DATA_VERSION } from '../js/store.js';
import { backupAge } from '../js/backup.js';
import { loggingDays } from '../js/habits.js';
import { toCSV } from '../js/trust.js';

let n = 0;
const id = () => `n${++n}`;
const NOW = '2026-11-25T20:00';
const month = budgetMonth(NOW, 1);
const balance = (s, now) => s.entries.filter((e) => e.at <= now).reduce((a, e) => a + signed(e), 0);

function dinner() {
  const s = freshState();
  s.entries.push({ id: 'pay', type: 'income', name: 'Paycheck', cents: 100000, at: '2026-11-20T09:00', category: 'Paycheck', note: '' });
  // $40 dinner, paid in full; friends owe $30.
  s.entries.push({ id: 'din', type: 'expense', name: 'Dinner', cents: 4000, owed: 3000, at: '2026-11-21T19:00', category: 'Eating Out', note: '' });
  return s;
}

// ---------- 13. Split bills ----------
test('split bill: only your share is spending; your money shows the whole bill until you\'re paid back', () => {
  const s = dinner();
  const sum = monthSummary(s.entries, month, NOW);
  assert.equal(sum.moneyOut.value, -1000, 'spending: your $10 share');
  assert.equal(sum.byCategory.find((c) => c.category === 'Eating Out').value, 1000);
  assert.equal(sum.owed.value, -3000, 'the friends\' $30 is out of your money for now');
  assert.equal(sum.left.value, 100000 - 4000, 'what\'s left matches your real money');
  assert.ok(sum.left.ok && sum.net.ok && sum.categoriesOk);
  assert.equal(receiptTotal(sum.left.receipt), sum.left.value);
  assert.equal(owedToYou(s, NOW).value, 3000);
  s.limits = { 'Eating Out': 5000 };
  assert.equal(categoryBudgets(s, month, NOW).rows.find((r) => r.category === 'Eating Out').spent.value, 1000);
});

test('paid back: the $30 comes back into your money, never as income or spending', () => {
  const s = dinner();
  markRepaid(s, 'din', '2026-11-23T12:00', id);
  const sum = monthSummary(s.entries, month, NOW);
  assert.equal(sum.moneyIn.value, 100000, 'not income');
  assert.equal(sum.moneyOut.value, -1000, 'spending unchanged');
  assert.equal(sum.owed.value, 0, 'out $30, back $30');
  assert.equal(sum.left.value, 100000 - 1000);
  assert.equal(owedToYou(s, NOW).value, 0);
  assert.equal(markRepaid(s, 'din', NOW, id), null, 'can\'t be paid back twice');
  unmarkRepaid(s, 'din');
  assert.equal(owedToYou(s, NOW).value, 3000);
});

test('left until payday counts the whole bill until repaid', () => {
  const s = dinner();
  addRule(s, { id: 'r', type: 'income', kind: 'paycheck', name: 'Paycheck', cents: 100000, category: 'Paycheck', freq: 'biweekly', anchor: '2026-12-04T09:00', nextIndex: 0, endAt: null }, NOW, id);
  const l = leftUntilPayday(s, NOW);
  assert.equal(l.value, balance(s, NOW));
  assert.equal(l.value, 96000);
  markRepaid(s, 'din', '2026-11-24T09:00', id);
  assert.equal(leftUntilPayday(s, NOW).value, 99000);
  assert.equal(receiptTotal(leftUntilPayday(s, NOW).receipt), 99000);
});

test('editing or deleting a split bill keeps the repayment in step', () => {
  const s = dinner();
  markRepaid(s, 'din', '2026-11-23T12:00', id);
  updateEntry(s, { ...s.entries.find((e) => e.id === 'din'), cents: 6000, owed: 4500 }, id);
  assert.equal(s.entries.find((e) => e.type === 'repaid').cents, 4500, 'repayment follows the new amount');
  updateEntry(s, cleanEntry({ ...s.entries.find((e) => e.id === 'din'), owed: undefined }), id);
  assert.equal(s.entries.some((e) => e.type === 'repaid'), false, 'no longer split: no repayment');
  const t = dinner();
  markRepaid(t, 'din', '2026-11-23T12:00', id);
  deleteEntry(t, 'din');
  assert.equal(t.entries.length, 1, 'the repayment goes with its bill');
});

test('split amounts are checked: friends can\'t owe the whole bill or more', () => {
  const ok = cleanEntry({ id: 'a', type: 'expense', name: 'X', cents: 4000, owed: 3999, at: NOW, category: 'Fun' });
  assert.equal(ok.owed, 3999);
  assert.equal(cleanEntry({ id: 'a', type: 'expense', name: 'X', cents: 4000, owed: 4000, at: NOW, category: 'Fun' }).owed, undefined);
  assert.equal(cleanEntry({ id: 'a', type: 'income', name: 'X', cents: 4000, owed: 100, at: NOW, category: 'Fun' }).owed, undefined);
  assert.equal(cleanEntry({ id: 'r', type: 'repaid', name: 'X', cents: 100, at: NOW, category: 'Fun' }), null, 'a repayment needs its bill');
  assert.equal(spendCents(ok), 1);
});

test('randomized: split bills, refunds and repayments always balance two ways', () => {
  for (let i = 0; i < 300; i++) {
    const s = freshState();
    for (let k = 0; k < 25; k++) {
      const at = `2026-11-${String(1 + Math.floor(Math.random() * 24)).padStart(2, '0')}T${String(Math.floor(Math.random() * 24)).padStart(2, '0')}:00`;
      const cents = 1 + Math.floor(Math.random() * 50000);
      const r = Math.random();
      const e = { id: id(), name: 'E', cents, at, category: r < 0.5 ? 'Fun' : 'Groceries', note: '' };
      if (r < 0.15) e.type = 'income';
      else if (r < 0.25) e.type = 'refund';
      else { e.type = 'expense'; if (cents > 1 && Math.random() < 0.4) e.owed = 1 + Math.floor(Math.random() * (cents - 1)); }
      s.entries.push(e);
      if (e.owed && Math.random() < 0.5) markRepaid(s, e.id, at, id);
    }
    const sum = monthSummary(s.entries, month, NOW);
    assert.ok(sum.left.ok && sum.net.ok && sum.categoriesOk && sum.owed.ok, `#${i}`);
    assert.equal(sum.left.value, balance(s, NOW));
    assert.equal(sum.moneyOut.value, -s.entries.reduce((a, e) => a + spendCents(e), 0));
  }
});

// ---------- 16. Cash ----------
test('cash on hand: your last count, minus cash spending and plus cash coming in since', () => {
  const s = freshState();
  s.settings.cash = { cents: 8000, at: '2026-11-20T10:00' };
  s.entries.push({ id: id(), type: 'expense', name: 'Coffee', cents: 450, at: '2026-11-21T09:00', category: 'Eating Out', note: '', cash: true });
  s.entries.push({ id: id(), type: 'income', name: 'Babysitting', cents: 3000, at: '2026-11-22T21:00', category: 'Other income', note: '', cash: true });
  s.entries.push({ id: id(), type: 'expense', name: 'Card purchase', cents: 9999, at: '2026-11-22T12:00', category: 'Shopping', note: '' });
  s.entries.push({ id: id(), type: 'expense', name: 'Before the count', cents: 500, at: '2026-11-19T12:00', category: 'Fun', note: '', cash: true });
  const c = cashOnHand(s, NOW);
  assert.equal(c.value, 8000 - 450 + 3000);
  assert.equal(receiptTotal(c.receipt), c.value);
  assert.equal(cashOnHand(freshState(), NOW), null, 'nothing counted yet');
  assert.ok(toCSV(s, NOW).includes(',Yes,'), 'cash shows in the spreadsheet');
});

// ---------- 17. Extras switches ----------
test('new people start with only the basics; existing data keeps what it had', () => {
  const fresh = freshState();
  assert.ok(EXTRA_KEYS.every((k) => !on(fresh, k)));
  const old = fromSaved({ version: 5, entries: [], settings: { adviceOn: true } });
  assert.equal(old.version, DATA_VERSION);
  for (const k of ['streak', 'nudges', 'weeklyWins', 'checkin', 'whatIf', 'costPerUse']) assert.ok(on(old, k), k);
  assert.ok(!on(old, 'splits') && !on(old, 'cash'), 'the two new extras start off');
  assert.equal(on(fromSaved({ version: 5, settings: { adviceOn: false } }), 'nudges'), false, 'notes follow the old switch');
  const set = cleanState({ settings: { extras: { cash: true, bogus: true } } });
  assert.equal(on(set, 'cash'), true);
  assert.ok(!('bogus' in set.settings.extras));
});

test('"Last backup: 9 days ago"', () => {
  assert.equal(backupAge(null, NOW), 'No backup yet');
  assert.equal(backupAge('2026-11-25T08:00', NOW), 'Last backup: today');
  assert.equal(backupAge('2026-11-24T23:59', NOW), 'Last backup: yesterday');
  assert.equal(backupAge('2026-11-16T10:00', NOW), 'Last backup: 9 days ago');
});

// ---------- 15. Late-night entries and daylight saving ----------
test('11:59 p.m. and 12:01 a.m. land on the right day, week and month', () => {
  const s = freshState();
  s.entries.push({ id: 'late', type: 'expense', name: 'Late', cents: 100, at: '2026-10-31T23:59', category: 'Fun', note: '' });
  s.entries.push({ id: 'early', type: 'expense', name: 'Early', cents: 200, at: '2026-11-01T00:01', category: 'Fun', note: '' });
  const now = '2026-11-02T12:00';
  assert.equal(periodTotals(s.entries, dayOf('2026-10-31T12:00'), now).moneyOut.value, -100);
  assert.equal(periodTotals(s.entries, dayOf('2026-11-01T12:00'), now).moneyOut.value, -200);
  assert.equal(monthSummary(s.entries, budgetMonth(now, 1), now).moneyOut.value, -200, 'October\'s 11:59 p.m. stays in October');
  assert.equal(monthSummary(s.entries, budgetMonth(now, 1), now).carry.value, -100);
  // Week starting Sunday Nov 1: the Saturday-night entry belongs to the week before.
  assert.equal(periodTotals(s.entries, weekOf('2026-11-01T12:00', 0), now).moneyOut.value, -200);
});

test('daylight-saving nights: the phone\'s local time is used, and no day is skipped or doubled', () => {
  // Spring forward (Mar 8, 2026) and fall back (Nov 1, 2026) in Calgary.
  assert.equal(toStamp(new Date(2026, 2, 8, 23, 59)), '2026-03-08T23:59');
  assert.equal(toStamp(new Date(2026, 2, 9, 0, 1)), '2026-03-09T00:01');
  assert.equal(toStamp(new Date(2026, 2, 8, 2, 30)).slice(0, 10), '2026-03-08', '2:30 a.m. doesn\'t exist that night, but the day is right');
  assert.equal(toStamp(new Date(2026, 10, 1, 1, 30)), '2026-11-01T01:30', 'the repeated hour');
  assert.equal(toStamp(new Date(2026, 10, 1, 23, 59)), '2026-11-01T23:59');
  // Day steps across both changes are exactly one calendar day each.
  for (const [y, m, d] of [[2026, 3, 7], [2026, 3, 8], [2026, 10, 31], [2026, 11, 1]]) {
    const next = addDays(y, m, d, 1);
    const real = new Date(y, m - 1, d + 1);
    assert.deepEqual([next.y, next.m, next.d], [real.getFullYear(), real.getMonth() + 1, real.getDate()]);
  }
  // Logged at 11:59 p.m. local on the fall-back day counts for that day, not the next.
  const s = freshState();
  s.entries.push({ id: 'x', type: 'expense', name: 'X', cents: 1, at: '2026-11-01T23:59', category: 'Fun', note: '', createdAt: new Date(2026, 10, 1, 23, 59).toISOString() });
  assert.deepEqual([...loggingDays(s)], ['2026-11-01']);
});

// ---------- 11. Speed with 5,000 entries ----------
test('5,000 entries: Home\'s numbers stay quick and exact', () => {
  const s = freshState();
  addRule(s, { id: 'pay', type: 'income', kind: 'paycheck', name: 'Paycheck', cents: 124000, category: 'Paycheck', freq: 'biweekly', anchor: '2025-12-05T09:00', nextIndex: 0, endAt: null }, NOW, id);
  const cats = ['Groceries', 'Eating Out', 'Transport', 'Fun', 'Shopping', 'Bills'];
  let k = 0;
  while (s.entries.length < 5000) {
    const d = addDays(2025, 12, 1, k % 359);
    const at = `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}T${String(8 + (k % 14)).padStart(2, '0')}:${String(k % 60).padStart(2, '0')}`;
    const e = { id: id(), type: k % 17 === 0 ? 'refund' : 'expense', name: `Item ${k}`, cents: 100 + ((k * 7919) % 9000), at, category: cats[k % cats.length], note: '' };
    if (e.type === 'expense' && k % 23 === 0) e.owed = Math.floor(e.cents / 2);
    addEntry(s, e, id);
    k++;
  }
  s.limits = { Groceries: 60000, Fun: 20000 };
  const t0 = performance.now();
  const sum = monthSummary(s.entries, month, NOW);
  const l = leftUntilPayday(s, NOW);
  const b = categoryBudgets(s, month, NOW);
  const ms = performance.now() - t0;
  assert.ok(sum.left.ok && l.ok && b.total.ok);
  assert.equal(sum.left.value, balance(s, NOW));
  assert.ok(ms < 1500, `took ${Math.round(ms)} ms`);
});
