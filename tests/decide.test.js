import { test } from 'node:test';
import assert from 'node:assert/strict';
import { goalForecast, forecastText, canAfford, staleNote, whatIf, subscriptionTotal, checkupDue, looksLikeSubscription, costPerUse, yearlyCost, usualCategorySpend } from '../js/decide.js';
import { leftUntilPayday, usualLeftover, futurePaydays } from '../js/pay.js';
import { addRule, logUse, undoUse, markChecked, setTracking } from '../js/ops.js';
import { freshState } from '../js/store.js';
import { receiptTotal } from '../js/calc.js';

const NOW = '2026-11-12T12:00'; // a Thursday
let n = 0;
const id = () => `d${++n}`;

// A paycheck every 2 weeks ($1,240): Oct 23 and Nov 6 have arrived; next is Nov 20.
function base() {
  const s = freshState();
  addRule(s, { id: 'pay', type: 'income', kind: 'paycheck', name: 'Paycheck', cents: 124000, category: 'Paycheck', freq: 'biweekly', anchor: '2026-10-23T09:00', nextIndex: 0, endAt: null }, NOW, id);
  s.entries.push({ id: 'rent', type: 'expense', name: 'Rent', cents: 60000, at: '2026-10-25T09:00', category: 'Housing', note: '' });
  s.entries.push({ id: 'food', type: 'expense', name: 'Groceries', cents: 8000, at: '2026-11-08T12:00', category: 'Groceries', note: '' });
  return s;
}
const goal = (s, gid, name, target, saved = 0, at = '2026-01-01T09:00') => {
  s.goals.push({ id: gid, name, targetCents: target, createdAt: '' });
  if (saved) s.entries.push({ id: `${gid}-in`, type: 'saving', name: `To ${name}`, cents: saved, at, category: 'Savings', note: '', goalId: gid });
};
// Independent day count with the built-in Date.
const daysBetween = (a, b) => Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 86400000);

// ---------- Goal finish dates ----------
test('auto-save only: 10% of $1,240 a paycheck, $1,500 to go → 13 paychecks → May 7, 2027', () => {
  const s = base();
  goal(s, 'car', 'Car', 200000, 50000);
  s.settings.autoSave = [{ goalId: 'car', bp: 1000 }];
  const f = goalForecast(s, s.goals[0], NOW);
  assert.equal(f.pace.share, 12400);
  assert.equal(f.toGo, 150000);
  assert.equal(f.nPays, 13);
  assert.equal(f.at.slice(0, 10), '2027-05-07');
  assert.equal(f.days, daysBetween(NOW, '2027-05-07'));
  assert.equal(f.label, 'May 7, 2027');
  assert.equal(forecastText(f), 'At this pace, $2,000.00 by May 7, 2027');
  assert.ok(f.fromPays + f.fromTopUps >= f.toGo);
});

test('top-ups only: $90 added in the last 90 days is about $1 a day', () => {
  const s = base();
  goal(s, 'car', 'Car', 62000, 50000);
  s.entries.push({ id: 't', type: 'saving', name: 'To Car', cents: 9000, at: '2026-10-01T09:00', category: 'Savings', note: '', goalId: 'car' });
  const f = goalForecast(s, s.goals[0], NOW);
  assert.equal(f.pace.topUp90, 9000);
  assert.equal(f.toGo, 3000);
  assert.equal(f.days, 30);
  assert.equal(f.at.slice(0, 10), '2026-12-12');
});

test('top-ups older than 90 days and auto-saved money don\'t count as top-ups', () => {
  const s = base();
  goal(s, 'car', 'Car', 100000, 5000, '2026-08-01T09:00');
  s.entries.push({ id: 'auto', type: 'saving', name: 'To Car', cents: 1000, at: '2026-11-06T09:00', category: 'Savings', note: '', goalId: 'car', parentId: 'x' });
  const f = goalForecast(s, s.goals[0], NOW);
  assert.equal(f.pace.topUp90, 0);
  assert.ok(f.none);
  assert.equal(forecastText(f), 'Add money or turn on auto-save to see a finish date');
});

test('reached goals have no date; far-off ones say more than 10 years', () => {
  const s = base();
  goal(s, 'a', 'Done', 1000, 1000);
  goal(s, 'b', 'Far', 50000000, 0);
  s.settings.autoSave = [{ goalId: 'b', bp: 1 }]; // 0.01% = 12¢ a paycheck
  assert.ok(goalForecast(s, s.goals[0], NOW).done);
  assert.equal(forecastText(goalForecast(s, s.goals[1], NOW)), 'At this pace, more than 10 years away');
});

test('random goals: the date matches an independent count of paydays', () => {
  for (let i = 0; i < 150; i++) {
    const s = base();
    const target = 1000 + Math.floor(Math.random() * 3000000);
    const saved = Math.floor(Math.random() * target);
    goal(s, 'g', 'G', target, saved);
    const bp = 1 + Math.floor(Math.random() * 5000);
    s.settings.autoSave = [{ goalId: 'g', bp }];
    const f = goalForecast(s, s.goals[0], NOW);
    const share = Math.floor((124000 * bp) / 10000);
    const need = Math.ceil((target - saved) / share);
    // nth payday after Nov 12: Nov 20 + 14(n-1) days
    const t = new Date(Date.UTC(2026, 10, 20 + 14 * (need - 1)));
    const expectDays = daysBetween(NOW, t.toISOString().slice(0, 10));
    if (expectDays > 3653) assert.ok(f.beyond, `#${i}`);
    else assert.equal(f.days, expectDays, `#${i}: target ${target} saved ${saved} bp ${bp}`);
  }
});

// ---------- Can I afford it? ----------
test('yes: fits in what\'s left until payday, with the new per-day amount', () => {
  const s = base();
  const L = leftUntilPayday(s, NOW).value;
  assert.equal(L, 124000 * 2 - 60000 - 8000);
  const r = canAfford(s, NOW, 10000);
  assert.equal(r.verdict, 'yes');
  assert.equal(r.after, L - 10000);
  assert.equal(receiptTotal(r.receipt), r.after);
  assert.equal(r.perDay.days, 8);
  assert.equal(r.perDay.value, Math.floor((L - 10000) / 8));
  assert.equal(canAfford(s, NOW, L).verdict, 'yes', 'exactly what\'s left still fits');
});

test('yes, but: the gap comes from the goal furthest from finishing, and says how far it\'s pushed back', () => {
  const s = base();
  goal(s, 'near', 'Phone', 100000, 95000);
  goal(s, 'far', 'Car', 500000, 20000);
  s.settings.autoSave = [{ goalId: 'near', bp: 1000 }, { goalId: 'far', bp: 500 }];
  const L = leftUntilPayday(s, NOW).value;
  const r = canAfford(s, NOW, L + 10000);
  assert.equal(r.verdict, 'yesbut');
  assert.equal(r.goal.id, 'far');
  assert.equal(r.gap, 10000);
  assert.equal(receiptTotal(r.receipt), 0);
  assert.equal(r.pushed, r.after.days - r.before.days);
  assert.ok(r.pushed > 0);
  // Car gets $62 a paycheck: $100 more to go is 2 more paychecks = 28 days
  assert.equal(r.pushed, 28);
});

test('yes, but skips goals that don\'t hold enough', () => {
  const s = base();
  goal(s, 'small', 'Shoes', 50000, 3000);
  goal(s, 'big', 'Trip', 500000, 40000);
  const L = leftUntilPayday(s, NOW).value;
  const r = canAfford(s, NOW, L + 5000);
  assert.equal(r.goal.id, 'big');
});

test('not yet: short amount ÷ what\'s usually left from a paycheck, rounded up', () => {
  const s = base();
  const L = leftUntilPayday(s, NOW).value;
  const lo = usualLeftover(s, NOW);
  assert.equal(lo.value, 124000 - 60000, 'Oct 23 → Nov 6: paycheck minus rent');
  const r = canAfford(s, NOW, L + 128001);
  assert.equal(r.verdict, 'notyet');
  assert.equal(r.gap, 128001);
  assert.equal(receiptTotal(r.receipt), -128001);
  assert.equal(r.paychecks.value, 3);
  assert.equal(r.paychecks.when, '2026-12-18T09:00');
  assert.equal(canAfford(s, NOW, L + 128000).paychecks.value, 2);
});

test('not yet with nothing left over: no made-up number of paychecks', () => {
  const s = base();
  s.entries.push({ id: 'big', type: 'expense', name: 'Car repair', cents: 100000, at: '2026-10-30T09:00', category: 'Transport', note: '' });
  const r = canAfford(s, NOW, 999999);
  assert.equal(r.verdict, 'notyet');
  assert.equal(r.paychecks, null);
});

test('no pay set up, or a bad price: no answer', () => {
  assert.equal(canAfford(freshState(), NOW, 1000).reason, 'nopay');
  assert.equal(canAfford(base(), NOW, 0).ok, false);
  assert.equal(canAfford(base(), NOW, 1.5).ok, false);
});

test('"Based on entries up to Sunday" after 3 quiet days', () => {
  const s = base();
  assert.equal(staleNote(s, NOW), 'Based on entries up to Sunday.');
  assert.equal(staleNote(s, '2026-11-10T12:00'), null);
  assert.equal(staleNote(s, '2026-11-20T08:00'), 'Based on entries up to Nov 8.');
  assert.equal(canAfford(s, NOW, 100).stale, 'Based on entries up to Sunday.');
});

test('usual leftover rounds down, negatives too', () => {
  const s = freshState();
  for (const [d, c] of [['2026-09-01', 1001], ['2026-09-15', 1000], ['2026-09-29', 1000], ['2026-10-13', 1000]]) {
    s.entries.push({ id: d, type: 'income', name: 'Paycheck', cents: c, at: `${d}T09:00`, category: 'Paycheck', note: '' });
  }
  s.entries.push({ id: 'x', type: 'expense', name: 'X', cents: 3000, at: '2026-09-20T09:00', category: 'Other', note: '' });
  // periods: 1001, 1000-3000 = -2000, 1000 → total 1 → ÷3 → 0 (rounded down)
  assert.equal(usualLeftover(s, '2026-10-20T09:00').value, 0);
  s.entries.push({ id: 'y', type: 'expense', name: 'Y', cents: 2, at: '2026-09-02T09:00', category: 'Other', note: '' });
  assert.equal(usualLeftover(s, '2026-10-20T09:00').value, -1, '-1 ÷ 3 rounds down to -1¢');
});

test('irregular pay: paydays follow the usual gap, an overdue one counts as tomorrow', () => {
  const s = freshState();
  s.settings.payMode = 'irregular';
  for (const d of ['2026-10-01', '2026-10-11', '2026-10-21']) s.entries.push({ id: d, type: 'income', name: 'Pay', cents: 50000, at: `${d}T09:00`, category: 'Paycheck', note: '' });
  assert.deepEqual(futurePaydays(s, '2026-10-25T12:00', '2026-11-20T00:00'), ['2026-10-31T09:00', '2026-11-10T09:00']);
  assert.deepEqual(futurePaydays(s, NOW, '2026-12-01T00:00'), ['2026-11-13T09:00', '2026-11-23T09:00']);
});

// ---------- What-if ----------
test('what if: $40 more a paycheck to Car finishes 42 days sooner (nothing saved)', () => {
  const s = base();
  goal(s, 'car', 'Car', 200000, 50000);
  s.settings.autoSave = [{ goalId: 'car', bp: 1000 }];
  const before = JSON.stringify(s);
  const w = whatIf(s, NOW, { goalId: 'car', perPaycheck: 4000 });
  assert.equal(w.after.nPays, 10);
  assert.equal(w.sooner, 42);
  assert.equal(JSON.stringify(s), before, 'practice mode never changes your data');
  assert.equal(whatIf(s, NOW, { goalId: 'car', perPaycheck: 0 }).ok, false);
});

test('usual category spending per pay period', () => {
  const s = base();
  s.entries.push({ id: 'e1', type: 'expense', name: 'Tim', cents: 1550, at: '2026-10-24T09:00', category: 'Eating Out', note: '' });
  s.entries.push({ id: 'r1', type: 'refund', name: 'Tim', cents: 550, at: '2026-10-26T09:00', category: 'Eating Out', note: '' });
  assert.equal(usualCategorySpend(s, NOW, 'Eating Out'), 1000);
});

// ---------- Subscriptions ----------
const sub = (o) => ({ id: id(), type: 'expense', kind: 'subscription', category: 'Bills', nextIndex: 0, endAt: null, anchor: '2026-08-01T09:00', ...o });

test('yearly total of subscriptions only (not rent), with a receipt that adds up', () => {
  const s = freshState();
  s.recurring.push(sub({ name: 'Netflix', cents: 1699, freq: 'monthly' }));
  s.recurring.push(sub({ name: 'Gym', cents: 4500, freq: 'monthly' }));
  s.recurring.push(sub({ name: 'Coffee club', cents: 500, freq: 'weekly' }));
  s.recurring.push(sub({ name: 'Rent', kind: 'bill', cents: 150000, freq: 'monthly' }));
  s.recurring.push(sub({ name: 'Old app', cents: 999, freq: 'monthly', endAt: '2026-01-01T00:00' }));
  const t = subscriptionTotal(s);
  assert.equal(t.value, 1699 * 12 + 4500 * 12 + 500 * 52);
  assert.equal(receiptTotal(t.receipt), t.value);
  assert.equal(t.count, 3);
  assert.equal(yearlyCost(sub({ cents: 1000, freq: 'biweekly' })), 26000);
  assert.equal(yearlyCost(sub({ cents: 1000, freq: 'semimonthly' })), 24000);
  assert.equal(yearlyCost(sub({ cents: 1000, freq: 'yearly' })), 1000);
});

test('check-up every 3 months; "yes, still using it" waits another 3 months', () => {
  const s = freshState();
  s.recurring.push(sub({ id: 'n', name: 'Netflix', cents: 1699, freq: 'monthly', anchor: '2026-08-01T09:00' }));
  s.recurring.push(sub({ id: 'm', name: 'Music', cents: 1099, freq: 'monthly', anchor: '2026-10-01T09:00' }));
  assert.deepEqual(checkupDue(s, NOW).map((r) => r.id), ['n']);
  markChecked(s, 'n', NOW);
  assert.deepEqual(checkupDue(s, NOW), []);
  assert.deepEqual(checkupDue(s, '2027-02-10T12:00').map((r) => r.id), ['n', 'm']);
});

test('subscription-looking names', () => {
  for (const n of ['Netflix', 'Spotify Premium', 'GoodLife Fitness', 'iCloud+', 'Disney+', 'Xbox Game Pass']) assert.ok(looksLikeSubscription(n), n);
  for (const n of ['Rent', 'Car insurance', 'Phone bill', 'Hydro']) assert.ok(!looksLikeSubscription(n), n);
});

// ---------- Cost per use ----------
test('gym: $45 a month, used 3 times this month, $15 a use', () => {
  const s = freshState();
  const gym = sub({ id: 'gym', name: 'Gym', cents: 4500, freq: 'monthly', anchor: '2026-10-01T09:00' });
  s.recurring.push(gym);
  assert.equal(costPerUse(gym, NOW), null, 'no counter until turned on');
  setTracking(s, 'rule', 'gym', true);
  assert.equal(costPerUse(gym, NOW).text, '$45.00 a month, not used yet this month');
  for (const at of ['2026-10-20T18:00', '2026-11-02T18:00', '2026-11-05T18:00', '2026-11-09T18:00']) logUse(s, 'rule', 'gym', at);
  const c = costPerUse(gym, NOW);
  assert.equal(c.uses, 3, 'October\'s visit belongs to last month');
  assert.equal(c.value, 1500);
  assert.equal(c.text, '$45.00 a month, used 3 times this month, that\'s $15.00 a use');
  undoUse(s, 'rule', 'gym', '2026-11-09T18:00');
  assert.equal(costPerUse(gym, NOW).value, 2250);
  setTracking(s, 'rule', 'gym', false);
  assert.ok(!('uses' in gym));
});

test('a big purchase: price ÷ every use so far, rounded down', () => {
  const bike = { id: 'b', type: 'expense', name: 'Bike', cents: 60000, at: '2026-10-01T12:00', category: 'Transport', uses: [] };
  for (let i = 1; i <= 7; i++) bike.uses.push(`2026-10-${String(i + 1).padStart(2, '0')}T08:00`);
  const c = costPerUse(bike, NOW);
  assert.equal(c.value, 8571);
  assert.equal(c.text, '$600.00, used 7 times, that\'s $85.71 a use');
});
