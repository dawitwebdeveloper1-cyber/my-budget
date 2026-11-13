import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sampleState } from '../js/sample.js';
import { cleanState, freshState } from '../js/store.js';
import { leftUntilPayday } from '../js/pay.js';
import { monthSummary } from '../js/calc.js';
import { budgetMonth } from '../js/dates.js';
import { goalProgress } from '../js/budget.js';
import { subscriptionTotal } from '../js/decide.js';

for (const now of ['2026-11-12T22:00', '2026-03-01T07:00', '2028-02-29T12:00', '2027-01-01T00:30']) {
  test(`example data is valid and every number checks out (${now})`, () => {
    const s = sampleState(now);
    assert.deepEqual(cleanState(JSON.parse(JSON.stringify(s))).entries.length, s.entries.length, 'every example entry is valid data');
    assert.ok(s.entries.every((e) => e.at <= now || e.type === 'expense'), 'nothing from the future except scheduled bills');
    assert.ok(s.entries.filter((e) => !e.auto && !e.parentId).length > 15, 'enough to look around');
    const lup = leftUntilPayday(s, now);
    assert.ok(lup.ok, 'Left until payday works');
    assert.ok(monthSummary(s.entries, budgetMonth(now, 1), now).left.ok);
    for (const g of s.goals) assert.ok(goalProgress(g, s.entries, now).ok);
    assert.ok(subscriptionTotal(s).ok);
    assert.equal(s.settings.setupDone, true);
    assert.deepEqual(s.notice, [], 'no pop-ups on the way in');
  });
}

test('right after setup (first payday still ahead), Left until payday already works', async () => {
  const { addRule } = await import('../js/ops.js');
  const s = freshState();
  let i = 0;
  addRule(s, { id: 'p', type: 'income', kind: 'paycheck', name: 'Paycheck', cents: 124000, category: 'Paycheck', freq: 'biweekly', anchor: '2026-11-20T09:00', nextIndex: 0, endAt: null }, '2026-11-13T10:00', () => `x${++i}`);
  const l = leftUntilPayday(s, '2026-11-13T10:00');
  assert.ok(l.ok);
  assert.equal(l.value, 0);
  assert.equal(l.next, '2026-11-20T09:00');
});

test('setup only for a brand-new phone', async () => {
  const { needsSetup } = await import('../js/views/setup.js');
  const fresh = freshState();
  assert.equal(needsSetup(fresh), true);
  assert.equal(needsSetup({ ...fresh, settings: { ...fresh.settings, setupDone: true } }), false);
  assert.equal(needsSetup({ ...fresh, entries: [{ id: 'a' }] }), false, 'anyone with data never sees it');
  assert.equal(cleanState({ settings: { setupDone: true } }).settings.setupDone, true);
});
