import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  budgetMonth, shiftBudgetMonth, weekOf, shiftWeek, dayOf, shiftDay,
  inPeriod, isStamp, makeStamp, formatTime, daysInMonth,
} from '../js/dates.js';

test('stamps validate', () => {
  assert.ok(isStamp('2026-11-08T14:05'));
  assert.ok(!isStamp('2026-02-30T10:00'));
  assert.ok(!isStamp('2026-11-08 14:05'));
  assert.ok(!isStamp('2026-13-01T00:00'));
  assert.ok(!isStamp('2026-11-08T24:00'));
  assert.equal(makeStamp(2026, 1, 5, 9, 0), '2026-01-05T09:00');
});

test('days in month incl. leap years', () => {
  assert.equal(daysInMonth(2026, 2), 28);
  assert.equal(daysInMonth(2028, 2), 29);
  assert.equal(daysInMonth(2026, 12), 31);
});

test('budget month starting on the 1st', () => {
  const p = budgetMonth('2026-11-08T14:00', 1);
  assert.equal(p.start, '2026-11-01T00:00');
  assert.equal(p.end, '2026-12-01T00:00');
  assert.equal(p.label, 'November 2026');
  assert.ok(inPeriod('2026-11-30T23:59', p));
  assert.ok(!inPeriod('2026-12-01T00:00', p));
  assert.ok(inPeriod('2026-11-01T00:00', p));
});

test('budget month starting on the 15th', () => {
  const a = budgetMonth('2026-11-08T10:00', 15);
  assert.equal(a.start, '2026-10-15T00:00');
  assert.equal(a.end, '2026-11-15T00:00');
  const b = budgetMonth('2026-11-15T00:00', 15);
  assert.equal(b.start, '2026-11-15T00:00');
});

test('budget month on the 31st clamps in short months', () => {
  const feb = budgetMonth('2026-03-10T10:00', 31);
  assert.equal(feb.start, '2026-02-28T00:00');
  assert.equal(feb.end, '2026-03-31T00:00');
  const next = shiftBudgetMonth(feb, 1);
  assert.equal(next.start, '2026-03-31T00:00');
  assert.equal(next.end, '2026-04-30T00:00');
});

test('budget months chain with no gaps or overlaps across a year end', () => {
  for (const startDay of [1, 10, 28, 29, 30, 31]) {
    let p = budgetMonth('2025-11-20T12:00', startDay);
    for (let i = 0; i < 30; i++) {
      const n = shiftBudgetMonth(p, 1);
      assert.equal(n.start, p.end, `startDay ${startDay}`);
      assert.ok(p.start < p.end);
      p = n;
    }
  }
  const dec = budgetMonth('2026-12-31T23:59', 1);
  assert.equal(shiftBudgetMonth(dec, 1).start, '2027-01-01T00:00');
  assert.equal(shiftBudgetMonth(dec, -12).start, '2025-12-01T00:00');
});

test('weeks start on Monday by default, Sunday if chosen', () => {
  // 2026-11-08 is a Sunday
  const mon = weekOf('2026-11-08T09:00', 1);
  assert.equal(mon.start, '2026-11-02T00:00');
  assert.equal(mon.end, '2026-11-09T00:00');
  const sun = weekOf('2026-11-08T09:00', 0);
  assert.equal(sun.start, '2026-11-08T00:00');
  assert.equal(shiftWeek(mon, -1).start, '2026-10-26T00:00');
  assert.equal(shiftWeek(weekOf('2026-12-30T00:00'), 1).start, '2027-01-04T00:00');
});

test('days', () => {
  const d = dayOf('2026-11-08T23:59');
  assert.equal(d.start, '2026-11-08T00:00');
  assert.equal(d.end, '2026-11-09T00:00');
  assert.equal(d.label, 'Sunday, Nov 8');
  assert.equal(shiftDay(dayOf('2026-02-28T01:00'), 1).start, '2026-03-01T00:00');
});

test('time formatting', () => {
  assert.equal(formatTime('2026-11-08T00:05'), '12:05 AM');
  assert.equal(formatTime('2026-11-08T12:00'), '12:00 PM');
  assert.equal(formatTime('2026-11-08T21:30'), '9:30 PM');
});
