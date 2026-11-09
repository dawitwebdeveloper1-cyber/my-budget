import { test } from 'node:test';
import assert from 'node:assert/strict';
import { occurrenceAt, generateDue, nextOccurrence, upcoming, buildICS, rrule } from '../js/recurring.js';

const rule = (o) => ({ id: 'r1', type: 'expense', name: 'Rent', cents: 110000, category: 'Housing', nextIndex: 0, endAt: null, ...o });

test('monthly on the 31st falls on the last day of short months', () => {
  const r = rule({ freq: 'monthly', anchor: '2026-01-31T09:00' });
  assert.deepEqual([0, 1, 2, 3, 12, 13, 25].map((k) => occurrenceAt(r, k)), [
    '2026-01-31T09:00', '2026-02-28T09:00', '2026-03-31T09:00', '2026-04-30T09:00', '2027-01-31T09:00', '2027-02-28T09:00', '2028-02-29T09:00',
  ]);
});

test('weekly, every two weeks and yearly', () => {
  assert.equal(occurrenceAt(rule({ freq: 'weekly', anchor: '2026-12-28T09:00' }), 1), '2027-01-04T09:00');
  assert.equal(occurrenceAt(rule({ freq: 'biweekly', anchor: '2026-11-06T09:00' }), 3), '2026-12-18T09:00');
  const leap = rule({ freq: 'yearly', anchor: '2028-02-29T09:00' });
  assert.equal(occurrenceAt(leap, 1), '2029-02-28T09:00');
  assert.equal(occurrenceAt(leap, 4), '2032-02-29T09:00');
});

test('only occurrences whose date and time have arrived are added', () => {
  let n = 0;
  const id = () => `e${++n}`;
  const r = rule({ freq: 'monthly', anchor: '2026-09-01T09:00' });
  const a = generateDue([r], '2026-11-01T08:59', id);
  assert.deepEqual(a.entries.map((e) => e.at), ['2026-09-01T09:00', '2026-10-01T09:00']);
  assert.equal(a.rules[0].nextIndex, 2);
  // running again at the same time adds nothing (no duplicates)
  assert.equal(generateDue(a.rules, '2026-11-01T08:59', id).entries.length, 0);
  const b = generateDue(a.rules, '2026-11-01T09:00', id);
  assert.deepEqual(b.entries.map((e) => [e.at, e.occurrence, e.recurringId, e.cents]), [['2026-11-01T09:00', 2, 'r1', 110000]]);
  assert.equal(r.nextIndex, 0, 'inputs are not changed');
});

test('ended rules stop', () => {
  const r = rule({ freq: 'weekly', anchor: '2026-11-02T09:00', endAt: '2026-11-16T09:00' });
  const out = generateDue([r], '2026-12-31T00:00', () => 'x');
  assert.deepEqual(out.entries.map((e) => e.at), ['2026-11-02T09:00', '2026-11-09T09:00']);
  assert.equal(nextOccurrence(out.rules[0]), null);
  assert.deepEqual(upcoming(r, 5), ['2026-11-02T09:00', '2026-11-09T09:00']);
});

test('calendar rules', () => {
  assert.equal(rrule(rule({ freq: 'monthly', anchor: '2026-11-03T09:00' })), 'FREQ=MONTHLY;BYMONTHDAY=3');
  assert.equal(rrule(rule({ freq: 'monthly', anchor: '2026-01-31T09:00' })), 'FREQ=MONTHLY;BYMONTHDAY=28,29,30,31;BYSETPOS=-1');
  assert.equal(rrule(rule({ freq: 'monthly', anchor: '2026-01-29T09:00' })), 'FREQ=MONTHLY;BYMONTHDAY=28,29;BYSETPOS=-1');
  assert.equal(rrule(rule({ freq: 'biweekly', anchor: '2026-11-06T09:00' })), 'FREQ=WEEKLY;INTERVAL=2');
});

test('calendar file has the event, the repeat and both alerts', () => {
  const r = rule({ freq: 'monthly', anchor: '2026-11-03T09:00', name: 'Netflix, Basic; plan', nextIndex: 1 });
  const ics = buildICS(r, { amountText: '$18.99', stampNow: new Date(Date.UTC(2026, 10, 8, 12, 0, 0)) });
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.match(ics, /\r\nDTSTART:20261203T090000\r\n/);
  assert.match(ics, /\r\nRRULE:FREQ=MONTHLY;BYMONTHDAY=3\r\n/);
  assert.match(ics, /\r\nSUMMARY:Netflix\\, Basic\\; plan – \$18\.99\r\n/);
  assert.match(ics, /TRIGGER:-P1D/);
  assert.match(ics, /TRIGGER:-PT1H/);
  assert.equal(ics.match(/BEGIN:VALARM/g).length, 2);
  assert.match(ics, /DTSTAMP:20261108T120000Z/);
  for (const line of ics.split('\r\n')) assert.ok(new TextEncoder().encode(line).length <= 75, `line too long: ${line}`);
});

test('long names are folded correctly', () => {
  const r = rule({ freq: 'weekly', anchor: '2026-11-03T09:00', name: 'A very long subscription name that keeps going and going ✨ forever and ever' });
  const ics = buildICS(r, { stampNow: new Date(0) });
  const unfolded = ics.replace(/\r\n /g, '');
  assert.match(unfolded, /SUMMARY:A very long subscription name that keeps going and going ✨ forever and ever\r\n/);
});
