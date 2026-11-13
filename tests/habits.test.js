import { test } from 'node:test';
import assert from 'node:assert/strict';
import { streak, streakText, loggingDays, paydayCheckin, weeklyWin, bestWeek, goalMonth } from '../js/habits.js';
import { addRule } from '../js/ops.js';
import { freshState, cleanState } from '../js/store.js';
import { receiptTotal } from '../js/calc.js';
import { budgetMonth } from '../js/dates.js';
import { adviceNote, categoryBudgets, weeklySnapshot } from '../js/budget.js';
import { monthSummary } from '../js/calc.js';
import { buildICS } from '../js/recurring.js';

let n = 0;
const id = () => `h${++n}`;
const e = (at, o = {}) => ({ id: id(), type: 'expense', name: 'Lunch', cents: 1000, at, category: 'Eating Out', note: '', ...o });
const days = (from, to, skip = []) => {
  const out = [];
  for (let d = from; d <= to; d++) if (!skip.includes(d)) out.push(`2026-11-${String(d).padStart(2, '0')}T12:00`);
  return out;
};

// ---------- Streak ----------
test('streak: one free skip a week; a second miss pauses it without losing the count', () => {
  const s = freshState();
  for (const at of days(2, 12, [10])) s.entries.push(e(at));
  const a = streak(s, '2026-11-12T20:00', 1); // Thursday; the week started Monday Nov 9
  assert.equal(a.count, 10);
  assert.equal(a.skipUsed, true);
  assert.equal(a.paused, false);
  assert.equal(streakText(a), '10-day streak');

  const t = freshState();
  for (const at of days(2, 9)) t.entries.push(e(at)); // nothing on the 10th or 11th
  const b = streak(t, '2026-11-12T08:00', 1);
  assert.equal(b.count, 8, 'paused, not wiped');
  assert.equal(b.paused, true);
  assert.equal(streakText(b), '8-day streak · paused');
  t.entries.push(e('2026-11-12T09:00'));
  const c = streak(t, '2026-11-12T09:30', 1);
  assert.equal(c.count, 9, 'logging again carries on from where it was');
  assert.equal(c.paused, false);
});

test('streak: today not logged yet is not a miss; repeating and auto-saved entries don\'t count; under 2 days shows nothing', () => {
  const s = freshState();
  s.entries.push(e('2026-11-09T12:00'), e('2026-11-10T12:00'), e('2026-11-11T12:00'));
  s.entries.push(e('2026-11-05T09:00', { auto: true }), e('2026-11-06T09:00', { type: 'saving', parentId: 'p', goalId: 'g' }));
  const a = streak(s, '2026-11-12T08:00', 1);
  assert.equal(a.count, 3);
  assert.equal(a.misses, 0);
  assert.equal(streakText(streak({ entries: [e('2026-11-12T09:00')] }, '2026-11-12T10:00', 1)), null);
  assert.equal(streak(freshState(), '2026-11-12T10:00'), null);
});

test('the day you logged it counts, even for an entry dated earlier', () => {
  const s = freshState();
  const created = new Date(2026, 10, 12, 10, 0).toISOString(); // logged on Nov 12 (local time)
  s.entries.push(e('2026-11-03T12:00', { createdAt: created }));
  assert.deepEqual([...loggingDays(s)], ['2026-11-12']);
});

// ---------- Payday check-in ----------
function payState() {
  const s = freshState();
  addRule(s, { id: 'pay', type: 'income', kind: 'paycheck', name: 'Paycheck', cents: 124000, category: 'Paycheck', freq: 'biweekly', anchor: '2026-10-09T09:00', nextIndex: 0, endAt: null }, '2026-11-07T12:00', id);
  s.entries.push(e('2026-10-10T12:00', { name: 'No Frills', cents: 10000, category: 'Groceries' }));
  s.entries.push(e('2026-10-24T12:00', { name: 'No Frills', cents: 6200, category: 'Groceries' }));
  s.entries.push(e('2026-10-25T12:00', { name: 'Tim', cents: 500, category: 'Eating Out' }));
  return s;
}

test('payday check-in: once per paycheck, in the 3 days after it, with how the last paycheck went', () => {
  const s = payState();
  const ci = paydayCheckin(s, '2026-11-07T12:00');
  assert.equal(ci.paycheck.at, '2026-11-06T09:00');
  assert.equal(ci.compare.value, 3800);
  assert.equal(ci.compare.text, 'You spent $38.00 less on Groceries than the paycheck before.');
  assert.equal(receiptTotal(ci.compare.receipt), 3800);
  assert.ok(ci.lup.ok);
  s.lastCheckin = ci.paycheck.id;
  assert.equal(paydayCheckin(s, '2026-11-07T13:00'), null, 'already seen');
  assert.equal(paydayCheckin(payState(), '2026-11-10T12:00'), null, 'more than 3 days later');
});

test('payday check-in never spins: if nothing went down, it says the plain facts', () => {
  const s = payState();
  s.entries.push(e('2026-10-30T12:00', { name: 'Shoes', cents: 9000, category: 'Shopping' }));
  s.entries = s.entries.filter((x) => !(x.category === 'Groceries' && x.cents === 6200));
  s.entries.push(e('2026-10-24T12:00', { name: 'No Frills', cents: 10000, category: 'Groceries' }));
  const ci = paydayCheckin(s, '2026-11-07T12:00');
  assert.equal(ci.compare.text, 'Last paycheck you spent $195.00, $95.00 more than the one before.');
  assert.equal(ci.compare.receipt, undefined);
});

test('payday check-in lists what auto-save moved', () => {
  const s = freshState();
  s.goals.push({ id: 'car', name: 'Car', targetCents: 100000, createdAt: '' });
  s.settings.autoSave = [{ goalId: 'car', bp: 1000 }];
  addRule(s, { id: 'pay', type: 'income', kind: 'paycheck', name: 'Paycheck', cents: 124000, category: 'Paycheck', freq: 'biweekly', anchor: '2026-11-06T09:00', nextIndex: 0, endAt: null }, '2026-11-06T10:00', id);
  const ci = paydayCheckin(s, '2026-11-06T10:00');
  assert.equal(ci.savedTotal, 12400);
  assert.equal(ci.compare, null, 'not enough history to compare yet');
});

// ---------- Weekly wins ----------
const MON = '2026-11-16T10:00'; // a Monday; last week = Nov 9–15, the week before = Nov 2–8

test('weekly win: saved more than the week before', () => {
  const s = freshState();
  s.entries.push(e('2026-11-10T09:00', { type: 'saving', name: 'To Car', cents: 5000, goalId: 'car' }));
  s.entries.push(e('2026-11-03T09:00', { type: 'saving', name: 'To Car', cents: 1000, goalId: 'car' }));
  const w = weeklyWin(s, MON, 1);
  assert.equal(w.text, 'Last week you saved $40.00 more than the week before.');
  assert.equal(receiptTotal(w.result.receipt), 4000);
  assert.equal(w.key, 'win:2026-11-09T00:00');
  assert.equal(weeklyWin(s, '2026-11-19T10:00', 1), null, 'only in the first 3 days of the week');
});

test('weekly win: spent less, but only when both weeks were really logged', () => {
  const s = freshState();
  for (const d of ['02', '03', '04']) s.entries.push(e(`2026-11-${d}T12:00`, { cents: 5000 }));
  for (const d of ['10', '11', '12']) s.entries.push(e(`2026-11-${d}T12:00`, { cents: 1000 }));
  const w = weeklyWin(s, MON, 1);
  assert.equal(w.text, 'Last week you spent $120.00 less than the week before.');
  assert.equal(receiptTotal(w.result.receipt), 12000);
  // A quiet week where nothing was logged is not a win.
  const q = freshState();
  for (const d of ['02', '03', '04']) q.entries.push(e(`2026-11-${d}T12:00`, { cents: 5000 }));
  assert.equal(weeklyWin(q, MON, 1), null);
});

test('weekly win: no-spend days, counted only in a week you logged on 4+ days', () => {
  const s = freshState();
  s.entries.push(e('2026-11-09T12:00'), e('2026-11-11T12:00'));
  s.entries.push(e('2026-11-12T12:00', { type: 'income', name: 'Side job', category: 'Other income' }));
  s.entries.push(e('2026-11-14T12:00', { type: 'income', name: 'Gift', category: 'Other income' }));
  assert.equal(weeklyWin(s, MON, 1).text, '5 no-spend days last week.');
  s.entries.pop();
  assert.equal(weeklyWin(s, MON, 1), null, 'only 3 logging days: no claim about no-spend days');
});

test('weekly win: falls back to goal progress, never invents one', () => {
  const s = freshState();
  s.goals.push({ id: 'car', name: 'Car', targetCents: 100000, createdAt: '' });
  s.entries.push(e('2026-11-10T09:00', { type: 'saving', name: 'To Car', cents: 5000, goalId: 'car' }));
  s.entries.push(e('2026-11-03T09:00', { type: 'saving', name: 'To Car', cents: 5000, goalId: 'car' }));
  assert.equal(weeklyWin(s, MON, 1).text, "Car grew $50.00 last week. It's 10% there.");
  assert.equal(weeklyWin(freshState(), MON, 1), null);
});

// ---------- Monthly recap ----------
test('recap: best week (only weeks you logged in) and goal progress', () => {
  const s = freshState();
  for (const d of ['02', '03', '04']) s.entries.push(e(`2026-11-${d}T12:00`, { cents: 2000 }));
  for (const d of ['10', '11', '12']) s.entries.push(e(`2026-11-${d}T12:00`, { cents: 1000 }));
  s.entries.push(e('2026-11-25T12:00', { cents: 100 })); // a week with one logging day doesn't count
  const period = budgetMonth('2026-11-15T12:00', 1);
  const b = bestWeek(s, period, '2026-12-02T12:00', 1);
  assert.equal(b.text, 'Best week: Nov 9 – Nov 15, $30.00 spent.');
  assert.equal(receiptTotal(b.receipt), 3000);
  s.goals.push({ id: 'car', name: 'Car', targetCents: 100000, createdAt: '' });
  s.entries.push(e('2026-11-20T09:00', { type: 'saving', name: 'To Car', cents: 25000, goalId: 'car' }));
  s.entries.push(e('2026-10-20T09:00', { type: 'saving', name: 'To Car', cents: 5000, goalId: 'car' }));
  const g = goalMonth(s, period, '2026-12-02T12:00');
  assert.equal(g[0].cents, 25000);
  assert.equal(g[0].percent, 30);
  assert.equal(receiptTotal(g[0].result.receipt), 25000);
});

// ---------- Gentle nudge ----------
test('nudge at 80% of a limit: calm, with what\'s left and the days to go', () => {
  const s = freshState();
  s.limits = { Groceries: 10000 };
  s.entries.push(e('2026-11-05T12:00', { cents: 8200, category: 'Groceries' }));
  const now = '2026-11-18T12:00';
  const period = budgetMonth(now, 1);
  const note = adviceNote({ budgets: categoryBudgets(s, period, now), summary: monthSummary(s.entries, period, now), snapshot: weeklySnapshot(s.entries, now, 1), period, now });
  assert.equal(note.text, 'Groceries is at 82% of its limit, with $18.00 left for the next 13 days.');
});

// ---------- Evening reminder ----------
test('"Log today?" is one daily calendar event that alerts at its own time', () => {
  const ics = buildICS({ id: 'my-budget-log-today', name: 'Log today?', cents: 0, freq: 'daily', anchor: '2026-11-12T20:00', nextIndex: 0, endAt: null },
    { alerts: ['PT0S'], description: 'Open My Budget and add anything you spent today.' });
  assert.match(ics, /RRULE:FREQ=DAILY\r\n/);
  assert.match(ics, /DTSTART:20261112T200000\r\n/);
  assert.match(ics, /TRIGGER:PT0S\r\n/);
  assert.equal((ics.match(/BEGIN:VALARM/g) ?? []).length, 1, 'never more than one alert a day');
  assert.equal(cleanState({ settings: { logReminder: '20:30' } }).settings.logReminder, '20:30');
  assert.equal(cleanState({ settings: { logReminder: '25:00' } }).settings.logReminder, null);
  assert.equal(cleanState({ lastCheckin: 'abc' }).lastCheckin, 'abc');
});
