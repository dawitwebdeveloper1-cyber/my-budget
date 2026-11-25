// The Part 8 test checklist, item by item. Items already covered elsewhere point to their file;
// everything else is tested here. All of it runs with `npm test` before anything is published.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sumCents, formatCents, parseAmount, MAX_ENTRY_CENTS } from '../js/money.js';
import { monthSummary, signed } from '../js/calc.js';
import { budgetMonth } from '../js/dates.js';
import { leftUntilPayday } from '../js/pay.js';
import { upcoming, nextOccurrence } from '../js/recurring.js';
import { subscriptionTotal } from '../js/decide.js';
import { freshState, cleanState, cleanEntry } from '../js/store.js';
import { makeBackup, parseBackup, readBackup } from '../js/backup.js';
import { createVault, newRecoveryKey } from '../js/crypto.js';
import { initStorage, memoryBackend } from '../js/storage.js';
import { app, change } from '../js/state.js';
import {
  addEntry, updateEntry, deleteEntry, addRule, editRule, stopRule, editFuture, deleteFuture,
  renameCategory, deleteCategory, addCategory, deleteGoal, logUse, setTracking, markChecked, runRecurring,
} from '../js/ops.js';
import { undoImport } from '../js/trust.js';

let n = 0;
const id = () => `k${++n}`;
const rule = (o) => ({ id: id(), type: 'income', kind: 'paycheck', name: 'Paycheck', cents: 124000, category: 'Paycheck', nextIndex: 0, endAt: null, ...o });
const spend = (at, cents, o = {}) => ({ id: id(), type: 'expense', name: 'Spend', cents, at, category: 'Groceries', note: '', ...o });

// ---------- 1. Money in cents: large amounts and $0 ----------
test('checklist 1: adding and subtracting cents, including the largest amounts and $0', () => {
  // The biggest single entry, a thousand times over, still adds up exactly.
  const big = Array(1000).fill(MAX_ENTRY_CENTS);
  assert.equal(sumCents(big), MAX_ENTRY_CENTS * 1000);
  assert.equal(formatCents(MAX_ENTRY_CENTS * 1000), '$10,000,000,000.00');
  // Money in minus money out, going below zero, to the cent.
  const s = freshState();
  s.entries.push({ id: 'i', type: 'income', name: 'Big', cents: MAX_ENTRY_CENTS, at: '2026-11-02T09:00', category: 'Other income', note: '' });
  s.entries.push(spend('2026-11-03T09:00', MAX_ENTRY_CENTS));
  s.entries.push(spend('2026-11-04T09:00', 1));
  const sum = monthSummary(s.entries, budgetMonth('2026-11-10T12:00', 1), '2026-11-10T12:00');
  assert.equal(sum.left.value, -1);
  assert.equal(formatCents(sum.left.value), '−$0.01');
  // $0: shows as $0.00, adds nothing, and can't be saved as an entry.
  assert.equal(formatCents(0), '$0.00');
  assert.equal(sumCents([]), 0);
  assert.equal(sumCents([0, 0, 5]), 5);
  assert.equal(parseAmount('0'), null);
  assert.equal(parseAmount('0.00'), null);
  assert.equal(cleanEntry(spend('2026-11-03T09:00', 0)), null);
  assert.equal(parseAmount('10000000.01'), null, 'over the per-entry limit');
  assert.throws(() => sumCents([0.5]));
});

// ---------- 2. Left until payday for every pay schedule ----------
// The independent check: everything that has happened (one plain loop) minus bills due before payday.
function independentLeft(s, now, billCents) {
  let total = 0;
  for (const e of s.entries) if (e.at <= now) total += signed(e);
  return total - billCents;
}

const SCHEDULES = [
  ['weekly', { freq: 'weekly', anchor: '2026-11-06T09:00' }, '2026-11-25T12:00', '2026-11-27T09:00', 2, 3],
  ['every 2 weeks', { freq: 'biweekly', anchor: '2026-10-23T09:00' }, '2026-11-25T12:00', '2026-12-04T09:00', 9, 3],
  ['twice a month (15th and last day)', { freq: 'semimonthly', days: [15, 31], anchor: '2026-10-15T09:00' }, '2026-11-25T12:00', '2026-11-30T09:00', 5, 3],
  ['monthly on the 31st', { freq: 'monthly', anchor: '2026-08-31T09:00' }, '2026-11-25T12:00', '2026-11-30T09:00', 5, 3],
  ['monthly on the 31st in a leap February', { freq: 'monthly', anchor: '2028-01-31T09:00' }, '2028-02-20T12:00', '2028-02-29T09:00', 9, 1],
  ['twice a month in a leap February', { freq: 'semimonthly', days: [15, 31], anchor: '2028-02-15T09:00' }, '2028-02-20T12:00', '2028-02-29T09:00', 9, 1],
];

for (const [label, r, now, next, days, paid] of SCHEDULES) {
  test(`checklist 2: left until payday, ${label}`, () => {
    const s = freshState();
    addRule(s, rule(r), now, id);
    assert.equal(s.entries.filter((e) => e.category === 'Paycheck').length, paid, 'paychecks so far');
    // Some spending, a refund, and a bill due tomorrow (before payday).
    const day = now.slice(0, 10);
    s.entries.push(spend(`${day}T08:00`, 4321), { id: id(), type: 'refund', name: 'Back', cents: 999, at: `${day}T08:30`, category: 'Groceries', note: '' });
    s.entries.push(spend('2026-01-01T09:00', 250)); // long ago: part of what carried in
    const billAt = `${day.slice(0, 8)}${String(Number(day.slice(8)) + 1).padStart(2, '0')}T07:00`;
    s.entries.push(spend(billAt, 5000, { name: 'Phone bill', category: 'Bills' }));
    const l = leftUntilPayday(s, now);
    assert.ok(l.ok);
    assert.equal(l.next, next);
    assert.equal(l.perDay.days, days);
    assert.equal(l.value, independentLeft(s, now, 5000));
    assert.equal(l.perDay.value, Math.floor(Math.max(0, l.value) / days));
  });
}

test('checklist 2: irregular pay estimates the next payday from the usual gap', () => {
  const s = freshState();
  s.settings.payMode = 'irregular';
  for (const d of ['2026-10-26', '2026-11-05', '2026-11-15']) s.entries.push({ id: id(), type: 'income', name: 'Shift pay', cents: 51000, at: `${d}T09:00`, category: 'Paycheck', note: '' });
  s.entries.push(spend('2026-11-16T12:00', 2000));
  const l = leftUntilPayday(s, '2026-11-20T12:00');
  assert.equal(l.next, '2026-11-25T09:00');
  assert.equal(l.value, independentLeft(s, '2026-11-20T12:00', 0));
});

// ---------- 10. Subscription renewal dates ----------
test('checklist 10: subscription renewal dates for every schedule, short months and leap years', () => {
  const sub = (o) => ({ id: id(), type: 'expense', kind: 'subscription', name: 'Sub', cents: 999, category: 'Fun', nextIndex: 0, endAt: null, ...o });
  assert.deepEqual(upcoming(sub({ freq: 'monthly', anchor: '2027-12-31T09:00' }), 4), ['2027-12-31T09:00', '2028-01-31T09:00', '2028-02-29T09:00', '2028-03-31T09:00']);
  assert.deepEqual(upcoming(sub({ freq: 'yearly', anchor: '2028-02-29T09:00' }), 3), ['2028-02-29T09:00', '2029-02-28T09:00', '2030-02-28T09:00']);
  assert.deepEqual(upcoming(sub({ freq: 'weekly', anchor: '2026-12-29T09:00' }), 2), ['2026-12-29T09:00', '2027-01-05T09:00']);
  // After some renewals have been added, the next one is the following date.
  const s = freshState();
  const r = sub({ freq: 'monthly', anchor: '2026-08-31T09:00' });
  s.recurring.push(r);
  runRecurring(s, '2026-11-25T12:00', id, { notify: false });
  assert.equal(s.entries.length, 3, 'Aug 31, Sep 30, Oct 31');
  assert.equal(nextOccurrence(s.recurring[0]), '2026-11-30T09:00');
  // A stopped subscription has no next renewal and leaves the yearly total.
  stopRule(s, r.id);
  assert.equal(nextOccurrence(s.recurring[0]), null);
  assert.equal(subscriptionTotal(s).value, 0);
});

// ---------- 11. Backup and restore give back exactly the same data ----------
function fullState() {
  // Every kind of thing the app saves, so nothing can quietly go missing from a backup.
  const raw = {
    version: 5,
    entries: [
      { id: 'p', type: 'income', name: 'Paycheck', cents: 124000, at: '2026-11-06T09:00', category: 'Paycheck', note: '', createdAt: '2026-11-06T15:00:00.000Z', recurringId: 'r1', occurrence: 2, auto: true, autoSave: [{ goalId: 'g1', bp: 1000 }], hours: 4000, rateCents: 3100 },
      { id: 's', type: 'saving', name: 'To Car', cents: 12400, at: '2026-11-06T09:00', category: 'Savings', note: '', goalId: 'g1', parentId: 'p', bp: 1000, auto: true },
      { id: 'x', type: 'expense', name: 'Bike', cents: 60000, at: '2026-10-01T12:00', category: 'Transport', note: 'a note, with "quotes"', uses: ['2026-10-02T08:00'], imported: true, importKey: 'k1', importBatch: 'b1' },
      { id: 'f', type: 'refund', name: 'Walmart', cents: 1299, at: '2026-11-09T15:30', category: 'Shopping', note: 'é ü 漢字 🙂' },
    ],
    recurring: [
      { id: 'r1', type: 'income', kind: 'paycheck', name: 'Paycheck', cents: 124000, category: 'Paycheck', freq: 'biweekly', anchor: '2026-10-23T09:00', nextIndex: 3, endAt: null },
      { id: 'r2', type: 'expense', kind: 'subscription', name: 'Gym', cents: 4500, category: 'Health', freq: 'monthly', anchor: '2026-10-01T09:00', nextIndex: 2, endAt: null, uses: ['2026-11-02T18:00'], checkedAt: '2026-11-01T10:00' },
      { id: 'r3', type: 'income', kind: 'other', name: 'Side', cents: 5000, category: 'Other income', freq: 'semimonthly', days: [1, 15], anchor: '2026-11-01T09:00', nextIndex: 0, endAt: '2027-01-01T00:00' },
    ],
    goals: [{ id: 'g1', name: 'Car', targetCents: 200000, createdAt: '2026-10-01' }],
    limits: { Groceries: 45000, 'Eating Out': 0 },
    adjustments: [{ id: 'a1', month: '2026-11-01T00:00', from: 'Fun', to: 'Groceries', cents: 2000 }],
    notice: ['p'], celebrated: ['g0'], favourites: [{ id: 'fv', type: 'expense', name: 'Bus', cents: 330, category: 'Transport' }],
    merchants: { 'expense:tim hortons': 'Eating Out' },
    importProfiles: { sig: { roles: { date: 0, amount: 2, debit: null, credit: null, desc: [1] }, dateOrder: 'ymd', signMode: 'negative-out' } },
    dismissedAdvice: ['install'], lastCheckin: 'p', lastImport: { batch: 'b1', count: 1, at: '2026-11-20T10:00' },
    milestones: { g1: 25 }, winAt: '2026-11-20T10:00', shareAskAt: null,
    categories: { expense: ['Housing', 'Groceries', 'Transport', 'Eating Out', 'Fun', 'Health', 'Shopping', 'Other'], income: ['Paycheck', 'Other income'] },
    settings: { monthStartDay: 15, weekStartDay: 0, autoSave: [{ goalId: 'g1', bp: 1000 }], payMode: 'schedule', hourlyRateCents: 3100, adviceOn: false, eventHour: 8, alertDays: 2, alertMinutes: 30, backupReminder: false, lastBackupAt: '2026-11-01T10:00', logReminder: '20:30', setupDone: true, lockAfter: 5, backupChecked: true, seenVersion: '2026.12' },
  };
  return cleanState(raw);
}

test('checklist 11: backup and restore give back exactly the same data, every field (plain and encrypted)', async () => {
  const s = fullState();
  assert.equal(s.entries.length, 4, 'all entries are valid');
  assert.equal(s.entries[2].uses.length, 1);
  assert.equal(s.recurring[1].checkedAt, '2026-11-01T10:00');
  assert.equal(s.settings.lockAfter, 5);
  const plain = await readBackup(parseBackup(JSON.stringify(await makeBackup({ state: s }))).backup);
  assert.deepEqual(plain.state, s);
  const { vault, dataKey } = await createVault(s, '135792', newRecoveryKey(), { passIter: 1000, recIter: 1000 });
  const enc = await readBackup(parseBackup(JSON.stringify(await makeBackup({ state: s, vault, dataKey }))).backup, '135792');
  assert.deepEqual(enc.state, s);
  // And saving it twice changes nothing (cleaning is stable).
  assert.deepEqual(cleanState(JSON.parse(JSON.stringify(s))), s);
});

// ---------- 12. Undo for every edit and delete ----------
// Each change goes through change(); pressing Undo must put back exactly what was there before.
await initStorage({ backend: memoryBackend(new Map()), legacy: null });

function undoCase(label, setup, act) {
  test(`checklist 12: undo ${label}`, () => {
    const s = fullState();
    setup?.(s);
    app.state = s;
    app.sample = false;
    let undo = null;
    app.notify = (msg, action) => { if (action) undo = action; };
    const before = JSON.stringify(app.state);
    change((st) => act(st), 'Done');
    assert.notEqual(JSON.stringify(app.state), before, 'the change did something');
    assert.ok(undo, 'Undo was offered');
    undo.run();
    assert.equal(JSON.stringify(app.state), before, 'Undo put back exactly what was there');
  });
}

const NOW = '2026-11-25T12:00';
undoCase('adding an entry', null, (st) => addEntry(st, spend('2026-11-24T12:00', 1500), id));
undoCase('adding a paycheck (and its auto-save)', null, (st) => addEntry(st, { id: id(), type: 'income', name: 'Paycheck', cents: 99999, at: '2026-11-24T09:00', category: 'Paycheck', note: '' }, id));
undoCase('editing an entry', null, (st) => updateEntry(st, { ...st.entries.find((e) => e.id === 'x'), cents: 61000, name: 'E-bike' }, id));
undoCase('editing a paycheck amount (its savings change too)', null, (st) => updateEntry(st, { ...st.entries.find((e) => e.id === 'p'), cents: 130000 }, id));
undoCase('deleting an entry', null, (st) => deleteEntry(st, 'f'));
undoCase('deleting a paycheck (and its savings)', null, (st) => deleteEntry(st, 'p'));
undoCase('editing "this and all future ones"', null, (st) => editFuture(st, 'p', { ...st.entries.find((e) => e.id === 'p'), cents: 125000 }, NOW, id));
undoCase('deleting "this and all future ones"', null, (st) => deleteFuture(st, 'p'));
undoCase('adding a repeating bill', null, (st) => addRule(st, { id: id(), type: 'expense', kind: 'bill', name: 'Rent', cents: 150000, category: 'Housing', freq: 'monthly', anchor: '2026-11-01T09:00', nextIndex: 0, endAt: null }, NOW, id));
undoCase('editing a repeating item', null, (st) => editRule(st, 'r2', { cents: 5000 }, NOW, id));
undoCase('stopping a repeating item', null, (st) => stopRule(st, 'r2'));
undoCase('renaming a category', null, (st) => renameCategory(st, 'expense', 'Groceries', 'Food'));
undoCase('deleting a category', null, (st) => deleteCategory(st, 'expense', 'Fun'));
undoCase('adding a category', null, (st) => addCategory(st, 'expense', 'Pets'));
undoCase('adding a goal', null, (st) => st.goals.push({ id: id(), name: 'Trip', targetCents: 50000, createdAt: '' }));
undoCase('editing a goal', null, (st) => { st.goals[0].targetCents = 300000; });
undoCase('deleting a goal with money in it', null, (st) => deleteGoal(st, 'g1'));
undoCase('changing auto-save', null, (st) => { st.settings.autoSave = [{ goalId: 'g1', bp: 2500 }]; });
undoCase('setting a category limit', null, (st) => { st.limits.Fun = 10000; });
undoCase('moving money between categories', null, (st) => st.adjustments.push({ id: id(), month: '2026-11-01T00:00', from: 'Housing', to: 'Fun', cents: 500 }));
undoCase('counting a use', null, (st) => logUse(st, 'rule', 'r2', NOW));
undoCase('turning a use counter off', null, (st) => setTracking(st, 'entry', 'x', false));
undoCase('"still using it" on a subscription', null, (st) => markChecked(st, 'r2', NOW));
undoCase('removing a whole bank import', null, (st) => undoImport(st, 'b1'));
undoCase('changing your pay schedule', null, (st) => editRule(st, 'r1', { freq: 'weekly', cents: 62000 }, NOW, id));
undoCase('a settings change', null, (st) => { st.settings.monthStartDay = 1; });

test('checklist 12: changes made without a message (like typing in Settings) offer no Undo, by design', () => {
  app.state = fullState();
  let offered = false;
  app.notify = (msg, action) => { if (action) offered = true; };
  change((st) => { st.settings.eventHour = 9; }, null);
  assert.equal(offered, false);
});

// ---------- Where the rest of the checklist is tested ----------
// 3. Three-paycheck months and leap years: pay.test.js ("every 2 weeks: bonus…", "weekly: 5-payday months…").
// 4. Auto-save splits with leftover cents: pay.test.js ("split across goals…", 5,000 random paychecks).
// 5. Can I afford it? yes / yes-but / not-yet: decide.test.js.
// 6. Goal timeline predictions: decide.test.js (fixed cases and 150 random goals).
// 7. Irregular income averages and ranges: pay.test.js and decide.test.js.
// 8. Bank import for each layout, duplicates, positive vs negative: bankimport.test.js.
// 9. Category budgets and moving money: budget.test.js, refund.test.js.
