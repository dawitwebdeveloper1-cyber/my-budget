import { test } from 'node:test';
import assert from 'node:assert/strict';
import { occurrenceAt, rrule } from '../js/recurring.js';
import { leftUntilPayday, payInfo, irregularStats, bigPaycheck, bonusMonths, bonusHeadsUp } from '../js/pay.js';
import { splitAcrossGoals } from '../js/budget.js';
import { addEntry, updateEntry, addRule, runRecurring } from '../js/ops.js';
import { freshState, cleanRule } from '../js/store.js';
import { receiptTotal } from '../js/calc.js';

let n = 0;
const id = () => `p${++n}`;
const rule = (o) => ({ id: id(), type: 'income', kind: 'paycheck', name: 'Paycheck', cents: 124000, category: 'Paycheck', nextIndex: 0, endAt: null, ...o });

// ---------- Twice a month ----------
test('twice a month: 15th and last day, including February and leap years', () => {
  const r = rule({ freq: 'semimonthly', days: [15, 31], anchor: '2026-01-15T09:00' });
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((k) => occurrenceAt(r, k)), [
    '2026-01-15T09:00', '2026-01-31T09:00', '2026-02-15T09:00', '2026-02-28T09:00', '2026-03-15T09:00', '2026-03-31T09:00',
  ]);
  const leap = rule({ freq: 'semimonthly', days: [15, 31], anchor: '2028-02-15T09:00' });
  assert.equal(occurrenceAt(leap, 1), '2028-02-29T09:00');
  // starting on the second day of the pair
  const late = rule({ freq: 'semimonthly', days: [1, 15], anchor: '2026-11-15T09:00' });
  assert.deepEqual([0, 1, 2].map((k) => occurrenceAt(late, k)), ['2026-11-15T09:00', '2026-12-01T09:00', '2026-12-15T09:00']);
  assert.equal(rrule(r), 'FREQ=MONTHLY;BYMONTHDAY=15,-1');
  assert.equal(rrule(late), 'FREQ=MONTHLY;BYMONTHDAY=1,15');
});

test('twice-a-month days are checked when saved', () => {
  assert.deepEqual(cleanRule({ ...rule({ freq: 'semimonthly', anchor: '2026-01-15T09:00' }), days: [15, 31] }).days, [15, 31]);
  assert.deepEqual(cleanRule({ ...rule({ freq: 'semimonthly', anchor: '2026-01-15T09:00' }), days: [29, 30] }).days, [15, 31], 'bad days fall back');
  assert.deepEqual(cleanRule({ ...rule({ freq: 'semimonthly', anchor: '2026-01-15T09:00' }), days: [10, 25] }).days, [10, 25]);
});

// ---------- Every schedule over several years ----------
// An independent count: walk the calendar day by day with the built-in Date (UTC) and count paydays.
function bruteForce(startY, startM, startD, stepDays, untilY) {
  const counts = new Map();
  for (let t = Date.UTC(startY, startM - 1, startD); new Date(t).getUTCFullYear() < untilY; t += stepDays * 86400000) {
    const d = new Date(t);
    const key = `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

test('every 2 weeks: bonus (3-payday) months match a day-by-day count, 2026 to 2031 (two leap years)', () => {
  const r = rule({ freq: 'biweekly', anchor: '2026-01-02T09:00' });
  const brute = bruteForce(2026, 1, 2, 14, 2032);
  const expected = [...brute.entries()].filter(([, c]) => c === 3).map(([k]) => k);
  const got = bonusMonths(r, '2026-01-01T00:00', 72).map((b) => `${b.y}-${b.m}`);
  assert.deepEqual(got, expected);
  // 26 or 27 paydays a year means 2 or 3 bonus months a year
  for (let y = 2026; y < 2032; y++) {
    const inYear = got.filter((k) => k.startsWith(`${y}-`)).length;
    assert.ok(inYear === 2 || inYear === 3, `${y}: ${inYear}`);
  }
});

test('weekly: 5-payday months match a day-by-day count, including Feb 29 paydays', () => {
  const r = rule({ freq: 'weekly', anchor: '2028-02-29T09:00' }); // a payday on a leap day
  const brute = bruteForce(2028, 2, 29, 7, 2031);
  const expected = [...brute.entries()].filter(([, c]) => c === 5).map(([k]) => k);
  assert.deepEqual(bonusMonths(r, '2028-02-01T00:00', 35).map((b) => `${b.y}-${b.m}`), expected);
});

test('monthly and twice-a-month pay never have bonus months', () => {
  assert.deepEqual(bonusMonths(rule({ freq: 'monthly', anchor: '2026-01-31T09:00' }), '2026-01-01T00:00', 60), []);
  assert.deepEqual(bonusMonths(rule({ freq: 'semimonthly', days: [15, 31], anchor: '2026-01-15T09:00' }), '2026-01-01T00:00', 60), []);
});

test('heads up the month before a bonus month, and during it', () => {
  const s = freshState();
  s.recurring.push(rule({ freq: 'biweekly', anchor: '2026-01-02T09:00' }));
  const bonus = bonusMonths(s.recurring[0], '2026-01-01T00:00', 12)[0];
  const before = `${bonus.m === 1 ? bonus.y - 1 : bonus.y}-${String(bonus.m === 1 ? 12 : bonus.m - 1).padStart(2, '0')}-10T12:00`;
  assert.match(bonusHeadsUp(s, before).text, /^Heads up: \w+ has a bonus paycheck \(3 paydays\)\./);
  const during = `${bonus.y}-${String(bonus.m).padStart(2, '0')}-10T12:00`;
  assert.match(bonusHeadsUp(s, during).text, /^This month has a bonus paycheck/);
});

// ---------- Left until payday ----------
function payState() {
  const s = freshState();
  addRule(s, rule({ id: 'pay', freq: 'biweekly', anchor: '2026-11-06T09:00' }), '2026-11-12T12:00', id);
  addRule(s, { id: 'rent', type: 'expense', kind: 'bill', name: 'Rent', cents: 60000, category: 'Housing', freq: 'monthly', anchor: '2026-11-15T09:00', nextIndex: 0, endAt: null }, '2026-11-12T12:00', id);
  addRule(s, { id: 'phone', type: 'expense', kind: 'bill', name: 'Phone', cents: 4500, category: 'Bills', freq: 'monthly', anchor: '2026-11-25T09:00', nextIndex: 0, endAt: null }, '2026-11-12T12:00', id);
  s.entries.push({ id: 'old', type: 'expense', name: 'Shoes', cents: 3000, at: '2026-11-01T12:00', category: 'Shopping', note: '' }); // before payday
  s.entries.push({ id: 'oldin', type: 'income', name: 'Gift', cents: 7000, at: '2026-10-30T12:00', category: 'Other income', note: '' });
  s.entries.push({ id: 'l1', type: 'expense', name: 'Lunch', cents: 1250, at: '2026-11-08T12:00', category: 'Eating Out', note: '' });
  s.entries.push({ id: 'rf', type: 'refund', name: 'Lunch', cents: 250, at: '2026-11-09T12:00', category: 'Eating Out', note: '' });
  return s;
}

test('left until payday: before-payday leftover + paycheck − spending − bills due before payday', () => {
  const s = payState();
  const now = '2026-11-12T12:00';
  const r = leftUntilPayday(s, now);
  assert.ok(r.ok);
  assert.equal(r.info.start, '2026-11-06T09:00');
  assert.equal(r.next, '2026-11-20T09:00');
  assert.deepEqual(r.bills.map((b) => [b.name, b.at]), [['Rent', '2026-11-15T09:00']], 'the phone bill is after payday');
  // 70 − 30 carried, + 1240 pay, − 12.50 lunch + 2.50 refund, − 600 rent due
  assert.equal(r.value, 4000 + 124000 - 1250 + 250 - 60000);
  assert.equal(receiptTotal(r.receipt), r.value);
  assert.deepEqual(r.receipt.lines.map((l) => l.label), [
    'Left from before payday', 'Paycheck', 'Lunch', 'Refund: Lunch', 'Due before payday: Rent',
  ]);
  // 8 days to Nov 20: $670.00 ÷ 8 = $83.75 a day
  assert.equal(r.perDay.days, 8);
  assert.equal(r.perDay.value, 8375);
});

test('per day rounds down and is never negative', () => {
  const s = payState();
  s.entries.push({ id: 'x', type: 'expense', name: 'Odd', cents: 1, at: '2026-11-12T08:00', category: 'Fun', note: '' });
  const r = leftUntilPayday(s, '2026-11-12T12:00');
  assert.equal(r.perDay.value, Math.floor(r.value / 8));
  s.entries.push({ id: 'big', type: 'expense', name: 'Laptop', cents: 200000, at: '2026-11-12T09:00', category: 'Shopping', note: '' });
  const broke = leftUntilPayday(s, '2026-11-12T12:00');
  assert.ok(broke.value < 0);
  assert.equal(broke.perDay.value, 0);
  assert.equal(receiptTotal(broke.receipt), broke.value);
});

test('the day before payday is 1 day; on payday a new period starts', () => {
  const s = payState();
  assert.equal(leftUntilPayday(s, '2026-11-19T20:00').perDay.days, 1);
  runRecurring(s, '2026-11-20T09:00', id);
  const r = leftUntilPayday(s, '2026-11-20T10:00');
  assert.equal(r.info.start, '2026-11-20T09:00');
  assert.equal(r.next, '2026-12-04T09:00');
});

test('no paycheck yet: nothing to show (Home falls back to the month)', () => {
  assert.equal(leftUntilPayday(freshState(), '2026-11-12T12:00').reason, 'nopay');
});

test('randomized: left until payday always matches your balance minus bills due, two ways', () => {
  for (let round = 0; round < 300; round++) {
    const s = payState();
    for (let i = 0; i < 30; i++) {
      const day = 1 + Math.floor(Math.random() * 12);
      const type = ['expense', 'expense', 'income', 'refund', 'saving'][i % 5];
      s.entries.push({ id: `z${round}-${i}`, type, name: `T${i}`, cents: 1 + Math.floor(Math.random() * 30000), at: `2026-11-${String(day).padStart(2, '0')}T${String(Math.floor(Math.random() * 24)).padStart(2, '0')}:00`, category: type === 'income' ? 'Other income' : 'Fun', note: '' });
    }
    const now = '2026-11-12T12:00';
    const r = leftUntilPayday(s, now);
    assert.ok(r.ok);
    const balance = s.entries.filter((e) => e.at <= now).reduce((a, e) => a + BigInt(['income', 'refund'].includes(e.type) ? e.cents : -e.cents), 0n);
    // set aside: rent, plus any spending already scheduled for later today (before payday)
    const scheduled = s.entries.filter((e) => e.type === 'expense' && e.at > now && e.at < '2026-11-20T09:00').reduce((a, e) => a + BigInt(e.cents), 0n);
    assert.equal(BigInt(r.value), balance - 60000n - scheduled);
    assert.equal(receiptTotal(r.receipt), r.value);
  }
});

// ---------- Irregular pay ----------
test('irregular pay: average of the last 3 paychecks, the range, and an estimated next payday', () => {
  const s = freshState();
  s.settings.payMode = 'irregular';
  for (const [d, c] of [['2026-10-01', 40000], ['2026-10-15', 61000], ['2026-10-29', 34000]]) {
    s.entries.push({ id: d, type: 'income', name: 'Paycheck', cents: c, at: `${d}T09:00`, category: 'Paycheck', note: '' });
  }
  const st = irregularStats(s, '2026-11-02T12:00');
  assert.equal(st.avg, 45000);
  assert.equal(st.low, 34000);
  assert.equal(st.high, 61000);
  const info = payInfo(s, '2026-11-02T12:00');
  assert.equal(info.mode, 'irregular');
  assert.equal(info.next, '2026-11-12T09:00', 'usual gap of 14 days');
  assert.equal(payInfo(s, '2026-11-20T12:00').next, null, 'overdue: no made-up date');
  assert.equal(payInfo(s, '2026-11-20T12:00').overdue, true);
  assert.equal(info.overdue, false);
  // Only one paycheck so far: no guess at the next payday, and not "overdue" either.
  s.entries = s.entries.slice(0, 1);
  const one = payInfo(s, '2026-10-05T12:00');
  assert.equal(one.next, null);
  assert.equal(one.overdue, false);
});

test('irregular average rounds down to the cent', () => {
  const s = freshState();
  for (const [d, c] of [['2026-10-01', 100], ['2026-10-08', 100], ['2026-10-15', 101]]) {
    s.entries.push({ id: d, type: 'income', name: 'Paycheck', cents: c, at: `${d}T09:00`, category: 'Paycheck', note: '' });
  }
  assert.equal(irregularStats(s, '2026-10-20T00:00').avg, 100);
});

test('a much bigger paycheck than usual suggests putting the extra toward goals', () => {
  const s = freshState();
  const days = ['2026-10-02', '2026-10-16', '2026-10-30', '2026-11-13'];
  const amounts = [50000, 52000, 48000, 90000];
  days.forEach((d, i) => s.entries.push({ id: d, type: 'income', name: 'Paycheck', cents: amounts[i], at: `${d}T09:00`, category: 'Paycheck', note: '' }));
  const b = bigPaycheck(s, '2026-11-14T10:00');
  assert.equal(b.usual, 50000);
  assert.equal(b.extra, 40000);
  assert.equal(bigPaycheck(s, '2026-11-20T10:00'), null, 'only right after payday');
  s.entries[3].cents = 60000;
  assert.equal(bigPaycheck(s, '2026-11-14T10:00'), null, 'a normal raise is not flagged');
});

// ---------- Auto-save across goals ----------
test('split across goals: each goal its percentage, leftover cents to the first goal', () => {
  const r = splitAcrossGoals(100001, [{ goalId: 'car', bp: 1200, name: 'Car' }, { goalId: 'ef', bp: 800, name: 'Emergency fund' }]);
  assert.deepEqual(r.shares.map((s) => s.cents), [12000, 8000]);
  assert.equal(r.save, 20000);
  assert.equal(r.spend, 80001);
  const odd = splitAcrossGoals(5, [{ goalId: 'a', bp: 5000, name: 'A' }, { goalId: 'b', bp: 5000, name: 'B' }]);
  assert.deepEqual(odd.shares.map((s) => s.cents), [3, 2], 'the leftover cent goes to the first goal');
  assert.equal(odd.leftover, 1);
  assert.equal(receiptTotal(odd.receipt), odd.spend);
  assert.match(odd.receipt.lines[1].label, /\+ 1¢ rounding/);
  assert.equal(splitAcrossGoals(100, [{ goalId: 'a', bp: 6000 }, { goalId: 'b', bp: 6000 }]).ok, false, 'over 100% is refused');
});

test('split across goals: 5,000 random paychecks always add up exactly', () => {
  for (let i = 0; i < 5000; i++) {
    const cents = 1 + Math.floor(Math.random() * 1_000_000_00);
    const parts = Array.from({ length: 1 + Math.floor(Math.random() * 4) }, (_, k) => ({ goalId: `g${k}`, bp: Math.floor(Math.random() * 2500), name: `G${k}` }));
    const r = splitAcrossGoals(cents, parts);
    if (!parts.some((p) => p.bp > 0)) { assert.equal(r.ok, false); continue; }
    assert.ok(r.ok);
    const totalBp = BigInt(parts.reduce((a, p) => a + p.bp, 0));
    assert.equal(BigInt(r.save), (BigInt(cents) * totalBp) / 10000n);
    assert.equal(r.shares.reduce((a, s) => a + s.cents, 0), r.save);
    assert.equal(r.save + r.spend, cents);
    assert.equal(receiptTotal(r.receipt), r.spend);
  }
});

test('a paycheck split across two goals, kept as logged when the settings change later', () => {
  const s = freshState();
  s.goals.push({ id: 'car', name: 'Car', targetCents: 200000 }, { id: 'ef', name: 'Emergency fund', targetCents: 100000 });
  s.settings.autoSave = [{ goalId: 'car', bp: 1200 }, { goalId: 'ef', bp: 800 }];
  const pay = { id: 'pp', type: 'income', name: 'Paycheck', cents: 100000, at: '2026-11-06T09:00', category: 'Paycheck', note: '' };
  addEntry(s, pay, id);
  const sv = () => s.entries.filter((e) => e.type === 'saving').map((e) => [e.goalId, e.cents]);
  assert.deepEqual(sv(), [['car', 12000], ['ef', 8000]]);
  s.settings.autoSave = [{ goalId: 'car', bp: 5000 }];
  updateEntry(s, { ...s.entries.find((e) => e.id === 'pp'), cents: 110000 }, id);
  assert.deepEqual(sv(), [['car', 13200], ['ef', 8800]], 'new amount, same split it was saved with');
});
