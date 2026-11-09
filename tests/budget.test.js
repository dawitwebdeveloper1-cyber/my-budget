import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseHours, formatHours, parsePercent, formatPercent, hoursPay, formatExact,
  autoSaveSplit, goalProgress, categoryBudgets, coverOptions, weeklySnapshot, adviceNote,
} from '../js/budget.js';
import { receiptTotal, monthSummary } from '../js/calc.js';
import { budgetMonth, makeStamp } from '../js/dates.js';

const NOW = '2026-11-08T14:00';
const NOV = budgetMonth(NOW, 1);
let n = 0;
const E = (type, cents, at, category = 'Other', extra = {}) => ({ id: `e${++n}`, type, cents, at, category, name: `${category} ${n}`, ...extra });

test('hours and percent parsing', () => {
  assert.equal(parseHours('37.5'), 3750);
  assert.equal(parseHours('40'), 4000);
  assert.equal(parseHours('.25'), 25);
  assert.equal(parseHours('0'), null);
  assert.equal(parseHours('1000'), null);
  assert.equal(parseHours('2.555'), null);
  assert.equal(formatHours(3750), '37.5');
  assert.equal(formatHours(4000), '40');
  assert.equal(parsePercent('10'), 1000);
  assert.equal(parsePercent('12.5%'), 1250);
  assert.equal(parsePercent('0'), 0);
  assert.equal(parsePercent('100'), 10000);
  assert.equal(parsePercent('100.01'), null);
  assert.equal(formatPercent(1250), '12.5%');
  assert.equal(formatPercent(1000), '10%');
});

test('hours × pay rounds to the nearest cent', () => {
  assert.equal(hoursPay(4000, 2000).value, 80000);          // 40 × $20 = $800
  const r = hoursPay(3750, 1725);                           // 37.5 × $17.25 = $646.875
  assert.equal(r.value, 64688);
  assert.equal(formatExact(r.receipt.exact), '$646.875');
  assert.equal(hoursPay(3333, 1001).value, 33363);          // 33.33 × $10.01 = $333.6333
  assert.equal(hoursPay(1, 1).value, 0);                    // 0.01 h × $0.01 = $0.0001 -> $0.00
  assert.equal(hoursPay(50, 1).value, 1);                   // 0.5 × $0.01 = $0.005 -> $0.01 (half rounds up)
  for (let i = 0; i < 5000; i++) {
    const h = 1 + Math.floor(Math.random() * 99999);
    const c = 1 + Math.floor(Math.random() * 1_000_000);
    const exact = (BigInt(h) * BigInt(c));
    const expect = Number((exact + 50n) / 100n);
    assert.equal(hoursPay(h, c).value, expect);
  }
});

test('auto-save split: savings rounds down, the rest stays spendable', () => {
  const s = autoSaveSplit(81235, 1000, 'New shoes');
  assert.equal(s.save, 8123);
  assert.equal(s.spend, 73112);
  assert.equal(receiptTotal(s.receipt), s.spend);
  assert.equal(autoSaveSplit(80000, 0).save, 0);
  assert.equal(autoSaveSplit(80000, 10000).spend, 0);
  for (let i = 0; i < 5000; i++) {
    const c = 1 + Math.floor(Math.random() * 10_000_000_00);
    const bp = Math.floor(Math.random() * 10001);
    const r = autoSaveSplit(c, bp);
    assert.ok(r.ok);
    assert.equal(r.save + r.spend, c);
    assert.ok(r.save * 10000 <= c * bp || BigInt(r.save) * 10000n <= BigInt(c) * BigInt(bp));
    assert.equal(receiptTotal(r.receipt), r.spend);
  }
});

test('goal progress counts only arrived savings for that goal', () => {
  const goal = { id: 'g1', name: 'New shoes', targetCents: 15000 };
  const entries = [
    E('saving', 5000, '2026-11-01T09:00', 'Savings', { goalId: 'g1' }),
    E('saving', 2500, '2026-11-07T09:00', 'Savings', { goalId: 'g1' }),
    E('saving', 9999, '2026-11-07T09:00', 'Savings', { goalId: 'g2' }),
    E('saving', 4000, '2026-11-20T09:00', 'Savings', { goalId: 'g1' }), // future
  ];
  const p = goalProgress(goal, entries, NOW);
  assert.equal(p.value, 7500);
  assert.equal(p.percent, 50);
  assert.equal(p.toGo, 7500);
  assert.equal(receiptTotal(p.receipt), 7500);
  assert.equal(goalProgress(goal, entries, '2026-12-01T00:00').percent, 76);
  const done = goalProgress({ ...goal, targetCents: 7000 }, entries, NOW);
  assert.ok(done.reached);
  assert.equal(done.percent, 100);
});

const baseState = () => ({
  categories: { expense: ['Housing', 'Eating Out', 'Shopping', 'Fun'], income: ['Paycheck'] },
  limits: { 'Eating Out': 10000, Shopping: 20000, Fun: 5000 },
  adjustments: [],
  entries: [
    E('expense', 13000, '2026-11-03T19:00', 'Eating Out'),
    E('expense', 4000, '2026-11-04T12:00', 'Shopping'),
    E('expense', 110000, '2026-11-01T09:00', 'Housing'),
    E('expense', 9999, '2026-11-30T09:00', 'Fun'), // future
    E('expense', 7000, '2026-10-30T09:00', 'Fun'), // last month
  ],
});

test('category budgets: spent, left, over', () => {
  const b = categoryBudgets(baseState(), NOV, NOW);
  const row = (c) => b.rows.find((r) => r.category === c);
  assert.equal(row('Eating Out').value, -3000);
  assert.equal(row('Eating Out').over, 3000);
  assert.equal(row('Shopping').value, 16000);
  assert.equal(row('Fun').value, 5000);
  assert.equal(row('Housing').limit, null);
  assert.equal(row('Housing').spent.value, 110000);
  for (const r of b.rows.filter((x) => x.limit !== null)) assert.equal(receiptTotal(r.receipt), r.value);
  assert.equal(b.total.value, 35000 - 17000);
  assert.equal(receiptTotal(b.total.receipt), b.total.value);
});

test('covering an overspend moves room between categories and keeps the total the same', () => {
  const s = baseState();
  const before = categoryBudgets(s, NOV, NOW);
  const opts = coverOptions(before, 'Eating Out');
  assert.deepEqual(opts.map((o) => o.category), ['Shopping', 'Fun']);
  s.adjustments.push({ id: 'a1', month: NOV.start, from: 'Shopping', to: 'Eating Out', cents: 3000 });
  const after = categoryBudgets(s, NOV, NOW);
  const row = (c) => after.rows.find((r) => r.category === c);
  assert.equal(row('Eating Out').value, 0);
  assert.equal(row('Eating Out').over, 0);
  assert.equal(row('Shopping').value, 13000);
  assert.equal(after.total.value, before.total.value, 'total budget still balances');
  for (const r of after.rows.filter((x) => x.limit !== null)) assert.equal(receiptTotal(r.receipt), r.value);
  // next month the borrowing is gone: limits reset
  const dec = budgetMonth('2026-12-05T10:00', 1);
  const next = categoryBudgets(s, dec, '2026-12-05T10:00');
  assert.equal(next.rows.find((r) => r.category === 'Shopping').effective, 20000);
});

test('weekly snapshot compares this week with last week', () => {
  const entries = [
    E('expense', 5000, '2026-11-03T10:00'), // this week (Mon Nov 2 – Sun Nov 8)
    E('expense', 2500, '2026-11-08T13:59'),
    E('expense', 9999, '2026-11-08T14:01'), // future
    E('expense', 4000, '2026-10-27T10:00'), // last week
    E('income', 90000, '2026-10-30T10:00'),
  ];
  const s = weeklySnapshot(entries, NOW, 1);
  assert.equal(s.thisOut.value, -7500);
  assert.equal(s.lastOut.value, -4000);
  assert.equal(s.diff.value, 3500);
  assert.equal(receiptTotal(s.diff.receipt), 3500);
  assert.equal(weeklySnapshot([], NOW, 1).diff.value, 0);
});

test('advice: only one gentle note, most important first, dismissible', () => {
  const s = baseState();
  const budgets = categoryBudgets(s, NOV, NOW);
  const summary = monthSummary(s.entries, NOV, NOW);
  const snapshot = weeklySnapshot(s.entries, NOW, 1);
  const a = adviceNote({ budgets, summary, snapshot, period: NOV, now: NOW });
  assert.match(a.text, /^Eating Out is \$30\.00 over/);
  const b = adviceNote({ budgets, summary, snapshot, period: NOV, now: NOW, dismissed: [a.key] });
  assert.notEqual(b?.key, a.key);
  const calm = adviceNote({ budgets: { rows: [] }, summary: { left: { ok: true, value: 100 } }, snapshot: { diff: { ok: true, value: 0 } }, period: NOV, now: NOW });
  assert.equal(calm, null);
});

test('randomized budgets always balance and receipts always add up', () => {
  const cats = ['A', 'B', 'C', 'D'];
  for (let round = 0; round < 500; round++) {
    const s = { categories: { expense: cats, income: [] }, limits: {}, adjustments: [], entries: [] };
    for (const c of cats) if (Math.random() < 0.8) s.limits[c] = Math.floor(Math.random() * 100000);
    for (let i = 0; i < 40; i++) {
      s.entries.push(E('expense', 1 + Math.floor(Math.random() * 20000), makeStamp(2026, 11, 1 + Math.floor(Math.random() * 28), 10, 0), cats[Math.floor(Math.random() * 4)]));
    }
    const before = categoryBudgets(s, NOV, '2026-11-30T23:59');
    for (const r of before.rows.filter((x) => x.over > 0)) {
      const opt = coverOptions(before, r.category)[0];
      if (opt) s.adjustments.push({ id: `a${round}`, month: NOV.start, from: opt.category, to: r.category, cents: Math.min(opt.room, r.over) });
      break;
    }
    const after = categoryBudgets(s, NOV, '2026-11-30T23:59');
    assert.ok(after.total.ok);
    assert.equal(after.total.value, before.total.value);
    for (const r of after.rows.filter((x) => x.limit !== null)) {
      assert.ok(r.ok);
      assert.equal(receiptTotal(r.receipt), r.value);
    }
  }
});
