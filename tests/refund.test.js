import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthSummary, periodTotals, receiptTotal } from '../js/calc.js';
import { categoryBudgets, weeklySnapshot, budgetProgress } from '../js/budget.js';
import { budgetMonth } from '../js/dates.js';
import { cleanEntry } from '../js/store.js';

const NOW = '2026-11-20T12:00';
const NOV = budgetMonth(NOW, 1);
let n = 0;
const E = (type, cents, at, category, name = `${type} ${++n}`) => ({ id: `r${++n}`, type, cents, at, category, name });

test('a refund goes back into its category and is not income', () => {
  const entries = [
    E('income', 50000, '2026-11-01T09:00', 'Paycheck', 'Paycheck'),
    E('expense', 10000, '2026-11-03T12:00', 'Shopping', 'Walmart'),
    E('refund', 4000, '2026-11-10T12:00', 'Shopping', 'Walmart'),
    E('expense', 2000, '2026-11-05T12:00', 'Eating Out'),
  ];
  const s = monthSummary(entries, NOV, NOW);
  assert.equal(s.moneyIn.value, 50000, 'refund is not counted as money in');
  assert.equal(s.moneyOut.value, -8000, 'spending is 100 + 20 − 40 back');
  assert.equal(s.left.value, 42000);
  assert.deepEqual(s.byCategory.map((c) => [c.category, c.value]), [['Shopping', 6000], ['Eating Out', 2000]]);
  for (const key of ['moneyIn', 'moneyOut', 'left', 'net']) assert.equal(receiptTotal(s[key].receipt), s[key].value, key);
  for (const c of s.byCategory) assert.equal(receiptTotal(c.receipt), c.value);
  const refundLine = s.moneyOut.receipt.lines.find((l) => l.type === 'refund');
  assert.equal(refundLine.label, 'Refund: Walmart');
  assert.equal(refundLine.cents, 4000);
  assert.ok(!s.moneyIn.receipt.lines.some((l) => l.type === 'refund'));
});

test('the monthly fee and its discount cancel out in Bills', () => {
  const entries = [
    E('expense', 1695, '2026-11-01T00:00', 'Bills', 'Service Charge Capped Monthly Fee'),
    E('refund', 1695, '2026-11-01T00:00', 'Bills', 'Service Charge Discount'),
  ];
  const t = periodTotals(entries, NOV, NOW);
  assert.equal(t.moneyOut.value, 0);
  assert.equal(t.moneyIn.value, 0);
  assert.equal(t.byCategory[0].value, 0);
  assert.ok(t.categoriesOk);
});

test('a refund the month after the purchase: last month\'s spending stays, this month gets money back', () => {
  const entries = [
    E('income', 10000, '2026-10-01T09:00', 'Paycheck'),
    E('expense', 5000, '2026-10-20T12:00', 'Shopping', 'Shoes'),
    E('refund', 5000, '2026-11-02T12:00', 'Shopping', 'Shoes'),
  ];
  const s = monthSummary(entries, NOV, NOW);
  assert.equal(s.carry.value, 5000);
  assert.equal(s.moneyOut.value, 5000, 'more came back than went out this month');
  assert.equal(s.left.value, 10000);
  assert.equal(receiptTotal(s.left.receipt), 10000);
  assert.ok(s.categoriesOk);
});

test('category budgets count refunds back, with the refund on the receipt', () => {
  const state = {
    categories: { expense: ['Shopping', 'Fun'], income: ['Paycheck'] },
    limits: { Shopping: 10000 }, adjustments: [],
    entries: [E('expense', 12000, '2026-11-03T12:00', 'Shopping', 'Hoodie'), E('refund', 3000, '2026-11-06T12:00', 'Shopping', 'Hoodie')],
  };
  const b = categoryBudgets(state, NOV, NOW);
  const row = b.rows.find((r) => r.category === 'Shopping');
  assert.equal(row.spent.value, 9000);
  assert.equal(row.value, 1000, 'was $20 over, the refund brings it to $10 left');
  assert.equal(row.over, 0);
  assert.equal(receiptTotal(row.receipt), row.value);
  assert.ok(row.receipt.lines.some((l) => l.label === 'Refund: Hoodie' && l.cents === 3000));
  assert.equal(b.total.value, 1000);
});

test('budget progress and the weekly snapshot both count refunds back', () => {
  const state = {
    categories: { expense: ['Shopping'], income: ['Paycheck'] },
    limits: { Shopping: 10000 }, adjustments: [],
    entries: [E('expense', 6000, '2026-11-16T12:00', 'Shopping'), E('refund', 1000, '2026-11-17T12:00', 'Shopping')],
  };
  const sum = monthSummary(state.entries, NOV, NOW);
  const p = budgetProgress(state, NOV, NOW, sum);
  assert.equal(p.spent, 5000);
  assert.equal(p.value, 50);
  assert.equal(receiptTotal(p.receipt.spentReceipt), 5000);
  const w = weeklySnapshot(state.entries, NOW, 1);
  assert.equal(w.thisOut.value, -5000);
  assert.ok(w.diff.ok);
});

test('more refunded than spent: progress shows 0%, never a negative or hidden number', () => {
  const state = {
    categories: { expense: ['Shopping'], income: ['Paycheck'] },
    limits: { Shopping: 10000 }, adjustments: [],
    entries: [E('refund', 2500, '2026-11-17T12:00', 'Shopping')],
  };
  const p = budgetProgress(state, NOV, NOW, monthSummary(state.entries, NOV, NOW));
  assert.ok(p.ok);
  assert.equal(p.value, 0);
});

test('refunds are saved and loaded like any other entry', () => {
  const e = cleanEntry({ id: 'x', type: 'refund', name: 'Walmart', cents: 4192, at: '2026-10-27T12:00', category: 'Shopping', note: '' });
  assert.equal(e.type, 'refund');
  assert.equal(cleanEntry({ ...e, type: 'gift' }), null);
});
