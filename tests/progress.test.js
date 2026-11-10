import { test } from 'node:test';
import assert from 'node:assert/strict';
import { budgetProgress, casualStatus, weeklySnapshot } from '../js/budget.js';
import { monthSummary, receiptTotal } from '../js/calc.js';
import { budgetMonth, makeStamp } from '../js/dates.js';

const NOW = '2026-11-08T14:00';
const NOV = budgetMonth(NOW, 1);
let n = 0;
const E = (type, cents, at, category = 'Other') => ({ id: `p${++n}`, type, cents, at, category, name: `${category} ${n}` });

const state = (entries, limits = {}) => ({
  categories: { expense: ['Housing', 'Groceries', 'Fun', 'Other'], income: ['Paycheck'] },
  limits, adjustments: [], entries,
});

function progressOf(s, now = NOW) {
  const sum = monthSummary(s.entries, NOV, now);
  return { p: budgetProgress(s, NOV, now, sum), sum };
}

test('with limits: spending in limited categories ÷ total of the limits', () => {
  const s = state([
    E('expense', 23300, '2026-11-02T10:00', 'Groceries'),
    E('expense', 110000, '2026-11-01T09:00', 'Housing'), // no limit: not part of the budget
    E('expense', 5000, '2026-11-20T09:00', 'Fun'),       // future
  ], { Groceries: 40000, Fun: 10000 });
  const { p } = progressOf(s);
  assert.equal(p.basis, 'budget');
  assert.equal(p.spent, 23300);
  assert.equal(p.base, 50000);
  assert.equal(p.value, 46);                         // 46.6% rounds down
  assert.equal(p.receipt.exact, 4660);               // 46.60%
  assert.equal(receiptTotal(p.receipt.spentReceipt), p.spent);
  assert.equal(receiptTotal(p.receipt.baseReceipt), p.base);
});

test('without limits: all spending ÷ money you had this month', () => {
  const s = state([
    E('income', 100000, '2026-10-10T09:00', 'Paycheck'),
    E('expense', 80000, '2026-10-20T09:00'),
    E('income', 50000, '2026-11-01T09:00', 'Paycheck'),
    E('saving', 5000, '2026-11-01T09:00', 'Savings'),
    E('expense', 13000, '2026-11-03T09:00'),
  ]);
  const { p } = progressOf(s);
  assert.equal(p.basis, 'money');
  assert.equal(p.base, 20000 + 50000 - 5000);
  assert.equal(p.spent, 13000);
  assert.equal(p.value, 20);
  assert.equal(receiptTotal(p.receipt.spentReceipt), p.spent);
  assert.equal(receiptTotal(p.receipt.baseReceipt), p.base);
});

test('over budget shows more than 100%; nothing to measure shows no bar', () => {
  const s = state([E('expense', 15000, '2026-11-02T10:00', 'Fun')], { Fun: 10000 });
  assert.equal(progressOf(s).p.value, 150);
  const empty = progressOf(state([])).p;
  assert.equal(empty.ok, false);
  assert.equal(empty.empty, true);
});

test('percent never rounds up to a milestone early', () => {
  const s = state([E('expense', 9999, '2026-11-02T10:00', 'Fun')], { Fun: 10000 });
  assert.equal(progressOf(s).p.value, 99);
});

test('randomized progress always matches a BigInt reference', () => {
  for (let i = 0; i < 1000; i++) {
    const entries = [];
    for (let k = 0; k < 25; k++) entries.push(E('expense', 1 + Math.floor(Math.random() * 50000), makeStamp(2026, 11, 1 + Math.floor(Math.random() * 7), 9, 0), ['Groceries', 'Fun', 'Other'][k % 3]));
    const limits = { Groceries: 1 + Math.floor(Math.random() * 500000), Fun: 1 + Math.floor(Math.random() * 500000) };
    const { p } = progressOf(state(entries, limits));
    const spent = entries.filter((e) => e.category !== 'Other').reduce((a, e) => a + BigInt(e.cents), 0n);
    const base = BigInt(limits.Groceries + limits.Fun);
    assert.equal(BigInt(p.value), (spent * 100n) / base);
    assert.equal(receiptTotal(p.receipt.spentReceipt), p.spent);
  }
});

test('casual status line', () => {
  const calm = state([E('income', 100000, '2026-11-01T09:00', 'Paycheck'), E('expense', 3000, '2026-11-03T09:00', 'Groceries')], { Groceries: 40000 });
  const run = (s, now = NOW) => {
    const summary = monthSummary(s.entries, NOV, now);
    const snapshot = weeklySnapshot(s.entries, now, 1);
    const progress = budgetProgress(s, NOV, now, summary);
    return casualStatus({ summary, snapshot, progress, period: NOV, now });
  };
  assert.equal(run(calm), "You're good this week");
  assert.equal(run(state([E('expense', 3000, '2026-11-03T09:00')])), 'Slow down a bit');            // below zero
  assert.equal(run(state([E('income', 900000, '2026-11-01T09:00', 'Paycheck'), E('expense', 39000, '2026-11-03T09:00', 'Groceries')], { Groceries: 40000 })), 'Slow down a bit'); // 97% used by day 8
  assert.equal(run(state([E('income', 100000, '2026-11-01T09:00', 'Paycheck')])), 'Quiet week so far');
  assert.equal(run(state([
    E('income', 900000, '2026-11-01T09:00', 'Paycheck'),
    E('expense', 2000, '2026-10-28T09:00'), E('expense', 9000, '2026-11-04T09:00'),
  ])), 'Spending is up this week. Slow down a bit');
});
