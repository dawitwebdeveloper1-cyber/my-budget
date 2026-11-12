import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthSummary, periodTotals, checked, receiptTotal, signed } from '../js/calc.js';
import { budgetMonth, weekOf, dayOf, makeStamp } from '../js/dates.js';

let n = 0;
const E = (type, cents, at, category = 'Other', name = `${type} ${++n}`) => ({ id: String(n), type, cents, at, category, name });

const NOW = '2026-11-08T14:00';
const NOV = budgetMonth(NOW, 1);

function assertReceiptsMatch(s) {
  for (const key of ['moneyIn', 'moneyOut', 'saved', 'net', 'carry', 'left']) {
    if (!s[key]) continue;
    assert.ok(s[key].ok, `${key} should verify`);
    assert.equal(receiptTotal(s[key].receipt), s[key].value, `${key} receipt must add up to the number shown`);
  }
  for (const c of s.byCategory) {
    assert.ok(c.ok);
    assert.equal(receiptTotal(c.receipt), c.value);
  }
}

test('basic month: in, out, savings, what is left', () => {
  const entries = [
    E('income', 80000, '2026-11-07T09:00', 'Paycheck', 'Paycheck'),
    E('saving', 8000, '2026-11-07T09:00', 'Savings', 'To savings'),
    E('expense', 1250, '2026-11-03T12:30', 'Eating Out', 'Lunch'),
    E('expense', 38750, '2026-11-01T09:00', 'Housing', 'Rent share'),
  ];
  const s = monthSummary(entries, NOV, NOW);
  assert.equal(s.moneyIn.value, 80000);
  assert.equal(s.saved.value, -8000);
  assert.equal(s.moneyOut.value, -40000);
  assert.equal(s.carry.value, 0);
  assert.equal(s.left.value, 32000);
  assert.equal(s.net.value, 32000);
  assert.equal(s.status, 'positive');
  assert.deepEqual(s.byCategory.map((c) => [c.category, c.value]), [['Housing', 38750], ['Eating Out', 1250]]);
  assert.ok(s.categoriesOk);
  assertReceiptsMatch(s);
});

test('entries only count once their exact date and time arrive', () => {
  const entries = [
    E('expense', 110000, '2026-11-28T09:00', 'Housing', 'Rent'), // future
    E('expense', 500, '2026-11-08T14:01', 'Fun'),                 // one minute from now
    E('expense', 700, '2026-11-08T14:00', 'Fun'),                 // exactly now: counts
  ];
  const s = monthSummary(entries, NOV, NOW);
  assert.equal(s.moneyOut.value, -700);
  assert.equal(s.left.value, -700);
  const later = monthSummary(entries, NOV, '2026-11-28T09:00');
  assert.equal(later.moneyOut.value, -111200);
  assertReceiptsMatch(later);
});

test('positive carry-over from last month', () => {
  const entries = [
    E('income', 50000, '2026-10-10T09:00'),
    E('expense', 35000, '2026-10-20T09:00'),
    E('income', 10000, '2026-11-02T09:00'),
  ];
  const s = monthSummary(entries, NOV, NOW);
  assert.equal(s.carry.value, 15000);
  assert.equal(s.left.value, 25000);
  assert.equal(s.net.value, 10000);
  assert.equal(s.previousLabel, 'October');
  assertReceiptsMatch(s);
});

test('negative carry-over keeps carrying until covered', () => {
  const entries = [
    E('expense', 6000, '2026-09-15T09:00'),
    E('income', 1000, '2026-10-15T09:00'),
    E('expense', 500, '2026-11-02T09:00'),
  ];
  const s = monthSummary(entries, NOV, NOW);
  assert.equal(s.carry.value, -5000);
  assert.equal(s.left.value, -5500);
  assert.equal(s.status, 'negative');
  assert.equal(s.carry.receipt.lines.length, 2); // September result, October result
  assertReceiptsMatch(s);
});

test('empty data is all zeros and still verified', () => {
  const s = monthSummary([], NOV, NOW);
  assert.equal(s.left.value, 0);
  assert.equal(s.status, 'even');
  assertReceiptsMatch(s);
});

test('a mismatch is caught instead of shown', () => {
  assert.deepEqual(checked(100, 100), { ok: true, value: 100 });
  assert.equal(checked(100, 101).ok, false);
  assert.equal(checked(100, 101).value, null);
  assert.equal(checked(NaN, NaN).ok, false);
  assert.equal(checked(0.5, 0.5).ok, false);
});

test('bad data is refused rather than added up', () => {
  const s = () => monthSummary([E('expense', 12.5, '2026-11-02T09:00')], NOV, NOW);
  assert.throws(s);
});

test('week and day totals', () => {
  const entries = [
    E('expense', 1000, '2026-11-02T00:00'), // Monday, start of week
    E('expense', 2000, '2026-11-08T23:59'), // Sunday night (future vs NOW)
    E('expense', 300, '2026-11-08T08:00'),
    E('expense', 4000, '2026-11-01T23:59'), // previous week
  ];
  const w = periodTotals(entries, weekOf(NOW, 1), NOW);
  assert.equal(w.moneyOut.value, -1300);
  const d = periodTotals(entries, dayOf(NOW), '2026-11-09T00:00');
  assert.equal(d.moneyOut.value, -2300);
});

// Reference implementation using BigInt and a totally different approach,
// compared against the app's calculations on thousands of random months.
function reference(entries, period, now) {
  let carry = 0n, inn = 0n, out = 0n, saved = 0n;
  for (const e of entries) {
    if (e.at > now) continue;
    const c = BigInt(e.cents);
    if (e.at < period.start) carry += e.type === 'income' || e.type === 'refund' ? c : -c;
    else if (e.at < period.end) {
      if (e.type === 'income') inn += c;
      else if (e.type === 'expense') out += c;
      else if (e.type === 'refund') out -= c; // money back lowers spending, never counts as income
      else saved += c;
    }
  }
  return { carry, inn, out, saved, left: carry + inn - out - saved };
}

test('randomized: 2,000 random budgets all verify and match a BigInt reference', () => {
  const types = ['income', 'expense', 'expense', 'expense', 'saving', 'refund'];
  const cats = ['Housing', 'Groceries', 'Fun', 'Bills', 'Other'];
  for (let round = 0; round < 2000; round++) {
    const count = Math.floor(Math.random() * 60);
    const entries = [];
    for (let i = 0; i < count; i++) {
      const y = 2025 + Math.floor(Math.random() * 2);
      const m = 1 + Math.floor(Math.random() * 12);
      const d = 1 + Math.floor(Math.random() * 28);
      const at = makeStamp(y, m, d, Math.floor(Math.random() * 24), Math.floor(Math.random() * 60));
      const big = Math.random() < 0.1;
      const cents = 1 + Math.floor(Math.random() * (big ? 1_000_000_00 : 200_000));
      entries.push(E(types[Math.floor(Math.random() * types.length)], cents, at, cats[Math.floor(Math.random() * cats.length)]));
    }
    const startDay = [1, 1, 15, 31][round % 4];
    const now = makeStamp(2026, 1 + Math.floor(Math.random() * 12), 1 + Math.floor(Math.random() * 28), 12, 0);
    const period = budgetMonth(now, startDay);
    const s = monthSummary(entries, period, now);
    const r = reference(entries, period, now);
    assertReceiptsMatch(s);
    assert.equal(BigInt(s.carry.value), r.carry);
    assert.equal(BigInt(s.moneyIn.value), r.inn);
    assert.equal(BigInt(-s.moneyOut.value), r.out);
    assert.equal(BigInt(-s.saved.value), r.saved);
    assert.equal(BigInt(s.left.value), r.left);
    assert.ok(s.categoriesOk);
    // receipt for "what's left" lists every counted entry in the month
    const counted = entries.filter((e) => e.at <= now && e.at >= period.start && e.at < period.end).length;
    assert.equal(s.left.receipt.lines.filter((l) => l.type !== 'carry').length, counted);
  }
});

test('signed amounts', () => {
  assert.equal(signed({ type: 'income', cents: 5 }), 5);
  assert.equal(signed({ type: 'expense', cents: 5 }), -5);
  assert.equal(signed({ type: 'saving', cents: 5 }), -5);
  assert.equal(signed({ type: 'refund', cents: 5 }), 5);
  assert.throws(() => signed({ type: 'gift', cents: 5 }));
});
